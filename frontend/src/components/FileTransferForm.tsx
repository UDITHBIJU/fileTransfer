import React, { useState, useRef, useEffect } from "react";
import { type Peer } from "../utils/types";
import { useSocketContext } from "../context/socketProvider";

interface FileTransferFormProps {
	peerSocketIds: string[];
	peers: { [id: string]: Peer };
}

interface FileChunk {
	type: string;
	fileName: string;
	fileId: string;
	chunkIndex: number;
	totalChunks: number;
	data: ArrayBuffer;
	fileSize: number;
}

interface FileReceiveBuffer {
	fileName: string;
	fileSize: number;
	totalChunks: number;
	receivedChunks: Map<number, ArrayBuffer>;
	receivedCount: number;
	lastReceivedTime: number;
}

interface ChunkAck {
	type: string;
	fileId: string;
	chunkIndex: number;
}

const CHUNK_SIZE = 16384; // 16KB chunks
const MAX_BUFFER_SIZE = 131072; // Increased to 128KB for better throughput
const INITIAL_WINDOW_SIZE = 32; // Initial concurrent chunks
const CHUNK_TIMEOUT = 3000; // Reduced to 3s for faster retries
const MAX_WINDOW_SIZE = 64; // Maximum concurrent chunks
const MIN_WINDOW_SIZE = 8; // Minimum concurrent chunks

export const FileTransferForm: React.FC<FileTransferFormProps> = ({
	peerSocketIds,
	peers,
}) => {
	const { socket, socketId, isConnected } = useSocketContext();
	const [selectedPeer, setSelectedPeer] = useState<string>("");
	const [file, setFile] = useState<File | null>(null);
	const [transferStatus, setTransferStatus] = useState<string | null>(null);
	const [transferProgress, setTransferProgress] = useState<number>(0);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const pcRef = useRef<RTCPeerConnection | null>(null);
	const dataChannelRef = useRef<RTCDataChannel | null>(null);
	const fileReceiveBuffers = useRef<Map<string, FileReceiveBuffer>>(new Map());
	const sendQueueRef = useRef<FileChunk[]>([]);
	const pendingChunksRef = useRef<
		Map<number, { chunk: FileChunk; timestamp: number; retries: number }>
	>(new Map());
	const currentFileIdRef = useRef<string | null>(null);
	const isSendingRef = useRef<boolean>(false);
	const windowSizeRef = useRef<number>(INITIAL_WINDOW_SIZE);
	const lastAckTimeRef = useRef<number>(Date.now());

	useEffect(() => {
		if (!socket || !socketId || !isConnected) return;

		const initializeWebRTC = () => {
			if (pcRef.current) pcRef.current.close();

			const pc = new RTCPeerConnection({
				iceServers: [
					{ urls: "stun:stun.l.google.com:19302" },
					{ urls: "stun:stun1.l.google.com:19302" },
					{ urls: "stun:stun2.l.google.com:19302" },
				],
			});
			pcRef.current = pc;

			const dataChannel = pc.createDataChannel("fileTransfer", {
				ordered: false,
				maxRetransmits: 0,
				negotiated: true,
				id: 0,
			});
			dataChannelRef.current = dataChannel;

			dataChannel.binaryType = "arraybuffer";

			dataChannel.onopen = () => {
				setTransferStatus("WebRTC connection established");
			};

			dataChannel.onclose = () => {
				setTransferStatus("WebRTC connection closed");
			};

			dataChannel.onerror = (error) => {
				console.error("Data channel error:", error);
				setTransferStatus("WebRTC connection error");
			};

			dataChannel.onmessage = (event) => {
				handleIncomingMessage(event.data);
			};

			pc.ondatachannel = (event) => {
				const channel = event.channel;
				channel.binaryType = "arraybuffer";
				dataChannelRef.current = channel;

				channel.onopen = () => {
					setTransferStatus("Ready to receive files");
				};

				channel.onmessage = (event) => {
					handleIncomingMessage(event.data);
				};

				channel.onerror = (error) => {
					console.error("Incoming data channel error:", error);
				};
			};

			pc.onicecandidate = (event) => {
				if (event.candidate && selectedPeer) {
					const targetDeviceId = Object.keys(peers).find(
						(id) => peers[id].socketId === selectedPeer
					);
					if (targetDeviceId) {
						socket.emit("ice-candidate", {
							toDeviceId: targetDeviceId,
							candidate: event.candidate,
						});
					}
				}
			};

			pc.onconnectionstatechange = () => {
				if (
					pc.connectionState === "failed" ||
					pc.connectionState === "disconnected"
				) {
					setTransferStatus(`Connection ${pc.connectionState}`);
					initializeWebRTC();
				}
			};
		};

		initializeWebRTC();

		socket.on("offer", async ({ fromDeviceId, offer }) => {
			if (!pcRef.current) return;
			try {
				await pcRef.current.setRemoteDescription(
					new RTCSessionDescription(offer)
				);
				const answer = await pcRef.current.createAnswer();
				await pcRef.current.setLocalDescription(answer);
				socket.emit("answer", { toDeviceId: fromDeviceId, answer });
			} catch (err) {
				console.error("Error handling offer:", err);
				setTransferStatus("Failed to establish connection");
			}
		});

		socket.on("answer", async ({ answer }) => {
			if (!pcRef.current) return;
			try {
				await pcRef.current.setRemoteDescription(
					new RTCSessionDescription(answer)
				);
			} catch (err) {
				console.error("Error handling answer:", err);
				setTransferStatus("Failed to complete connection");
			}
		});

		socket.on("ice-candidate", async ({ candidate }) => {
			if (!pcRef.current) return;
			try {
				await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
			} catch (err) {
				console.error("Error adding ICE candidate:", err);
			}
		});

		return () => {
			socket.off("offer");
			socket.off("answer");
			socket.off("ice-candidate");
			if (dataChannelRef.current) dataChannelRef.current.close();
			if (pcRef.current) pcRef.current.close();
		};
	}, [socket, socketId, isConnected, selectedPeer, peers]);

	const handleIncomingMessage = (data: ArrayBuffer) => {
		try {
			const text = new TextDecoder().decode(data);
			const message = JSON.parse(text);

			if (message.type === "file-chunk") {
				handleFileChunk(message);
			} else if (message.type === "file-complete") {
				handleFileComplete(message.fileId);
			} else if (message.type === "chunk-ack") {
				handleChunkAck(message);
			} else if (message.type === "file-start") {
				handleFileStart(message);
			}
		} catch (err) {
			console.error("Error parsing incoming message:", err);
		}
	};

	const handleFileStart = (message: {
		fileId: string;
		fileName: string;
		fileSize: number;
		totalChunks: number;
	}) => {
		const { fileId, fileName, fileSize, totalChunks } = message;
		fileReceiveBuffers.current.set(fileId, {
			fileName,
			fileSize,
			totalChunks,
			receivedChunks: new Map(),
			receivedCount: 0,
			lastReceivedTime: Date.now(),
		});
		setTransferStatus(`Starting to receive: ${fileName}`);
	};

	const handleFileChunk = (chunk: FileChunk) => {
		const { fileId, fileName, chunkIndex, totalChunks, data, fileSize } = chunk;
		const buffer = fileReceiveBuffers.current.get(fileId) || {
			fileName,
			fileSize,
			totalChunks,
			receivedChunks: new Map(),
			receivedCount: 0,
			lastReceivedTime: Date.now(),
		};

		if (!fileReceiveBuffers.current.has(fileId)) {
			fileReceiveBuffers.current.set(fileId, buffer);
		}

		if (!buffer.receivedChunks.has(chunkIndex)) {
			buffer.receivedChunks.set(chunkIndex, new Uint8Array(data).buffer);
			buffer.receivedCount++;
			buffer.lastReceivedTime = Date.now();

			const progress = (buffer.receivedCount / totalChunks) * 100;
			setTransferProgress(progress);
			setTransferStatus(`Receiving ${fileName}: ${Math.round(progress)}%`);

			const ack: ChunkAck = { type: "chunk-ack", fileId, chunkIndex };
			if (dataChannelRef.current?.readyState === "open") {
				dataChannelRef.current.send(
					new TextEncoder().encode(JSON.stringify(ack))
				);
			}

			if (buffer.receivedCount === totalChunks) {
				assembleAndSaveFile(fileId);
			}
		}
	};

	const handleChunkAck = (ack: ChunkAck) => {
		const { fileId, chunkIndex } = ack;
		if (currentFileIdRef.current === fileId) {
			pendingChunksRef.current.delete(chunkIndex);
			const now = Date.now();
			const rtt = now - lastAckTimeRef.current;
			lastAckTimeRef.current = now;

			// Adjust window size based on RTT
			if (rtt < 100) {
				windowSizeRef.current = Math.min(
					windowSizeRef.current + 4,
					MAX_WINDOW_SIZE
				);
			} else if (rtt > 300) {
				windowSizeRef.current = Math.max(
					windowSizeRef.current - 4,
					MIN_WINDOW_SIZE
				);
			}

			if (isSendingRef.current) {
				processSendQueue();
			}
		}
	};

	const assembleAndSaveFile = (fileId: string) => {
		const buffer = fileReceiveBuffers.current.get(fileId);
		if (!buffer) return;

		const completeFile = new Uint8Array(buffer.fileSize);
		let offset = 0;
		for (let i = 0; i < buffer.totalChunks; i++) {
			const chunk = buffer.receivedChunks.get(i);
			if (!chunk) {
				setTransferStatus(`Error: Missing chunk ${i} in ${buffer.fileName}`);
				return;
			}
			completeFile.set(new Uint8Array(chunk), offset);
			offset += new Uint8Array(chunk).length;
		}

		const blob = new Blob([completeFile]);
		saveFile(blob, buffer.fileName);
		setTransferStatus(`File received: ${buffer.fileName}`);
		setTransferProgress(0);
		fileReceiveBuffers.current.delete(fileId);
	};

	const handleFileComplete = (fileId: string) => {
		if (currentFileIdRef.current === fileId) {
			isSendingRef.current = false;
			currentFileIdRef.current = null;
			sendQueueRef.current = [];
			pendingChunksRef.current.clear();
			windowSizeRef.current = INITIAL_WINDOW_SIZE;
		}
	};

	const saveFile = (blob: Blob, fileName: string) => {
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	};

	const sendFileInChunks = async (file: File) => {
		if (
			!dataChannelRef.current ||
			dataChannelRef.current.readyState !== "open"
		) {
			throw new Error("Data channel not ready");
		}

		const fileId = `${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
		const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
		currentFileIdRef.current = fileId;
		isSendingRef.current = true;
		sendQueueRef.current = [];
		pendingChunksRef.current.clear();
		windowSizeRef.current = INITIAL_WINDOW_SIZE;

		setTransferProgress(0);
		setTransferStatus(`Preparing to send ${file.name}...`);

		const startMessage = {
			type: "file-start",
			fileId,
			fileName: file.name,
			fileSize: file.size,
			totalChunks,
		};
		dataChannelRef.current.send(
			new TextEncoder().encode(JSON.stringify(startMessage))
		);

		const fileReader = new FileReader();
		const chunks: FileChunk[] = [];
		for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
			const start = chunkIndex * CHUNK_SIZE;
			const end = Math.min(start + CHUNK_SIZE, file.size);
			const chunkBlob = file.slice(start, end);

			const arrayBuffer = await new Promise<ArrayBuffer>((resolve) => {
				fileReader.onload = () => resolve(fileReader.result as ArrayBuffer);
				fileReader.readAsArrayBuffer(chunkBlob);
			});

			chunks.push({
				type: "file-chunk",
				fileName: file.name,
				fileId,
				chunkIndex,
				totalChunks,
				data: arrayBuffer,
				fileSize: file.size,
			});
		}

		sendQueueRef.current = chunks;
		processSendQueue();

		const timeoutChecker = setInterval(() => {
			checkForTimeouts();
		}, 500);

		return new Promise<void>((resolve, reject) => {
			const checkComplete = () => {
				if (!isSendingRef.current) {
					clearInterval(timeoutChecker);
					resolve();
				} else if (
					sendQueueRef.current.length === 0 &&
					pendingChunksRef.current.size === 0
				) {
					const completeMessage = {
						type: "file-complete",
						fileId,
						fileName: file.name,
					};
					try {
						dataChannelRef.current!.send(
							new TextEncoder().encode(JSON.stringify(completeMessage))
						);
						setTransferStatus(`File sent: ${file.name}`);
						setTransferProgress(100);
						setTimeout(() => {
							setTransferProgress(0);
							isSendingRef.current = false;
							currentFileIdRef.current = null;
							clearInterval(timeoutChecker);
							resolve();
						}, 500);
					} catch (error) {
						clearInterval(timeoutChecker);
						reject(error);
					}
				} else {
					setTimeout(checkComplete, 50);
				}
			};
			setTimeout(checkComplete, 50);
		});
	};

	const processSendQueue = () => {
		if (
			!dataChannelRef.current ||
			dataChannelRef.current.readyState !== "open" ||
			!isSendingRef.current
		) {
			return;
		}

		const bufferedAmount = dataChannelRef.current.bufferedAmount;
		if (bufferedAmount > MAX_BUFFER_SIZE) {
			setTimeout(processSendQueue, 10);
			return;
		}

		while (
			sendQueueRef.current.length > 0 &&
			pendingChunksRef.current.size < windowSizeRef.current &&
			dataChannelRef.current.bufferedAmount < MAX_BUFFER_SIZE
		) {
			const chunk = sendQueueRef.current.shift();
			if (!chunk) break;

			try {
				dataChannelRef.current.send(
					new TextEncoder().encode(JSON.stringify(chunk))
				);
				pendingChunksRef.current.set(chunk.chunkIndex, {
					chunk,
					timestamp: Date.now(),
					retries: 0,
				});

				const totalChunks = chunk.totalChunks;
				const sentChunks = totalChunks - sendQueueRef.current.length;
				const progress = (sentChunks / totalChunks) * 100;
				setTransferProgress(progress);
				setTransferStatus(
					`Sending ${chunk.fileName}: ${Math.round(progress)}%`
				);
			} catch (error) {
				sendQueueRef.current.unshift(chunk);
				break;
			}
		}

		if (sendQueueRef.current.length > 0 && isSendingRef.current) {
			setTimeout(processSendQueue, 5);
		}
	};

	const checkForTimeouts = () => {
		if (!isSendingRef.current) return;

		const now = Date.now();
		const timedOutChunks: FileChunk[] = [];

		pendingChunksRef.current.forEach((pending, chunkIndex) => {
			if (now - pending.timestamp > CHUNK_TIMEOUT && pending.retries < 3) {
				timedOutChunks.push(pending.chunk);
				pendingChunksRef.current.set(chunkIndex, {
					...pending,
					timestamp: now,
					retries: pending.retries + 1,
				});
			} else if (pending.retries >= 3) {
				pendingChunksRef.current.delete(chunkIndex);
			}
		});

		if (timedOutChunks.length > 0) {
			windowSizeRef.current = Math.max(
				windowSizeRef.current - 2,
				MIN_WINDOW_SIZE
			);
			sendQueueRef.current = [...timedOutChunks, ...sendQueueRef.current];
			processSendQueue();
		}
	};

	const handlePeerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		setSelectedPeer(e.target.value);
		setTransferStatus(null);
		setTransferProgress(0);
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			setFile(e.target.files[0]);
			setTransferStatus(null);
			setTransferProgress(0);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!socket || !selectedPeer || !file || !isConnected) {
			setTransferStatus("Missing connection, peer, or file");
			return;
		}

		const targetDeviceId = Object.keys(peers).find(
			(id) => peers[id].socketId === selectedPeer
		);
		if (!targetDeviceId) {
			setTransferStatus(`Peer not found: ${selectedPeer}`);
			return;
		}

		try {
			if (!pcRef.current) throw new Error("No peer connection");

			const offer = await pcRef.current.createOffer();
			await pcRef.current.setLocalDescription(offer);
			socket.emit("offer", { toDeviceId: targetDeviceId, offer });

			await new Promise<void>((resolve, reject) => {
				const checkConnection = () => {
					if (dataChannelRef.current?.readyState === "open") {
						resolve();
					} else if (dataChannelRef.current?.readyState === "closed") {
						reject(new Error("Connection closed"));
					} else {
						setTimeout(checkConnection, 50);
					}
				};
				setTimeout(() => reject(new Error("Connection timeout")), 5000);
				checkConnection();
			});

			await sendFileInChunks(file);
			setFile(null);
			if (fileInputRef.current) fileInputRef.current.value = "";
		} catch (err) {
			console.error("File transfer error:", err);
			setTransferStatus(`Failed to send file: ${(err as Error).message}`);
			isSendingRef.current = false;
			currentFileIdRef.current = null;
		}
	};
	return (
		<div className="p-4 border rounded">
			<h2 className="text-lg font-bold mb-2">Send File</h2>
			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label htmlFor="peerSelect" className="block text-sm font-medium">
						Select Peer:
					</label>
					<select
						id="peerSelect"
						value={selectedPeer}
						onChange={handlePeerChange}
						className="p-2 border rounded w-full"
						disabled={peerSocketIds.length === 0 || !isConnected}
					>
						<option value="">Select a peer</option>
						{peerSocketIds.map((peerSocketId) => {
							const deviceId = Object.keys(peers).find(
								(id) => peers[id].socketId === peerSocketId
							);
							const peer = deviceId ? peers[deviceId] : null;
							const displayName = peer?.deviceName || deviceId || peerSocketId;
							return (
								<option key={peerSocketId} value={peerSocketId}>
									{displayName}
								</option>
							);
						})}
					</select>
				</div>
				<div>
					<label htmlFor="fileInput" className="block text-sm font-medium">
						Choose File:
					</label>
					<input
						id="fileInput"
						type="file"
						ref={fileInputRef}
						onChange={handleFileChange}
						className="p-2 border rounded w-full"
						disabled={
							peerSocketIds.length === 0 || !isConnected || isSendingRef.current
						}
					/>
					{file && (
						<p className="text-sm text-gray-600 mt-1">
							Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
						</p>
					)}
				</div>
				<button
					type="submit"
					disabled={
						!selectedPeer || !file || !isConnected || isSendingRef.current
					}
					className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
				>
					{isSendingRef.current ? "Sending..." : "Send File"}
				</button>
			</form>

			{transferStatus && (
				<div className="mt-4">
					<p
						className={`${
							transferStatus.includes("Failed") ||
							transferStatus.includes("not found") ||
							transferStatus.includes("Error")
								? "text-red-600"
								: transferStatus.includes("complete") ||
								  transferStatus.includes("received") ||
								  transferStatus.includes("sent")
								? "text-green-600"
								: "text-blue-600"
						}`}
					>
						{transferStatus}
					</p>
					{transferProgress > 0 && (
						<div className="w-full bg-gray-200 rounded-full h-2 mt-2">
							<div
								className="bg-blue-600 h-2 rounded-full transition-all duration-300"
								style={{ width: `${transferProgress}%` }}
							></div>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
