import React, { useState, useRef, useEffect } from "react";
import { type Peer } from "../utils/types";
import { useSocketContext } from "../context/socketProvider";

interface FileTransferFormProps {
	peerSocketIds: string[];
	peers: { [id: string]: Peer };
}

interface FileChunk {
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

const MESSAGE_TYPES = {
	FILE_START: 0,
	FILE_CHUNK: 1,
	CHUNK_ACK: 2,
	FILE_COMPLETE: 3,
} as const;

interface BinaryMessage {
	type: number;
	fileId: string;
	chunkIndex?: number;
	totalChunks?: number;
	fileSize?: number;
	fileName?: string; 
	payload?: ArrayBuffer;
	fileHash?: string;
}
 
const CHUNK_SIZE = 131072; // 64KB chunks 
const MAX_BUFFER_SIZE = 524288; // Increased to 512KB for better throughput 
const INITIAL_WINDOW_SIZE = 64; // Initial concurrent chunks
const CHUNK_TIMEOUT = 5000; // Reduced to 5s for faster retries
const MAX_WINDOW_SIZE = 128; // Maximum concurrent chunks
const MIN_WINDOW_SIZE = 16; // Minimum concurrent chunks
const HEADER_SIZE = 256;
const MAX_FILENAME_LENGTH = 201;

function encodeBinaryMessage(message: BinaryMessage): ArrayBuffer {
	const fileIdBytes = new TextEncoder().encode(message.fileId.padEnd(36, "\0"));
	const fileName = message.fileName || "";
	const fileNameBytes = new TextEncoder().encode(
		fileName.slice(0, MAX_FILENAME_LENGTH)
	);
	const fileNameLength = Math.min(fileNameBytes.length, MAX_FILENAME_LENGTH);
	const fileHash = message.fileHash || "";
	const fileHashBytes = new TextEncoder().encode(fileHash.padEnd(64, "\0"));

	const header = new ArrayBuffer(HEADER_SIZE);
	const view = new DataView(header);

	view.setUint8(0, message.type);
	fileIdBytes.forEach((byte, i) => view.setUint8(1 + i, byte));
	if (message.chunkIndex !== undefined)
		view.setUint32(37, message.chunkIndex, true);
	if (message.totalChunks !== undefined)
		view.setUint32(41, message.totalChunks, true);
	if (message.fileSize !== undefined)
		view.setBigUint64(45, BigInt(message.fileSize), true);
	if (message.fileName !== undefined) view.setUint16(53, fileNameLength, true);
	fileNameBytes.forEach((byte, i) => view.setUint8(55 + i, byte));
	if (message.fileHash !== undefined) {
		fileHashBytes.forEach((byte, i) => view.setUint8(256 + i, byte));
	}

	if (message.payload) {
		const combined = new Uint8Array(HEADER_SIZE + message.payload.byteLength);
		combined.set(new Uint8Array(header), 0);
		combined.set(new Uint8Array(message.payload), HEADER_SIZE);
		return combined.buffer;
	}
	return header;
}

function decodeBinaryMessage(data: ArrayBuffer): BinaryMessage {
	const view = new DataView(data);
	const type = view.getUint8(0);
	const fileIdBytes = new Uint8Array(data, 1, 36);
	const fileId = new TextDecoder().decode(fileIdBytes).replace(/\0/g, "");

	const message: BinaryMessage = { type, fileId };

	if (type === MESSAGE_TYPES.FILE_CHUNK || type === MESSAGE_TYPES.CHUNK_ACK) {
		message.chunkIndex = view.getUint32(37, true);
	}
	if (type === MESSAGE_TYPES.FILE_START || type === MESSAGE_TYPES.FILE_CHUNK) {
		message.totalChunks = view.getUint32(41, true);
		message.fileSize = Number(view.getBigUint64(45, true));
		const fileNameLength = view.getUint16(53, true);
		const fileNameBytes = new Uint8Array(
			data,
			55,
			Math.min(fileNameLength, MAX_FILENAME_LENGTH)
		);
		message.fileName = new TextDecoder().decode(fileNameBytes);
	}
	if (type === MESSAGE_TYPES.FILE_COMPLETE) {
		const fileHashBytes = new Uint8Array(data, 256, 64);
		message.fileHash = new TextDecoder()
			.decode(fileHashBytes)
			.replace(/\0/g, "");
	}
	if (type === MESSAGE_TYPES.FILE_CHUNK && data.byteLength > HEADER_SIZE) {
		message.payload = data.slice(HEADER_SIZE);
	}

	return message;
}

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
				maxRetransmits: 3,
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
			const message = decodeBinaryMessage(data);

			if (message.type === MESSAGE_TYPES.FILE_START) {
				handleFileStart(message);
			} else if (message.type === MESSAGE_TYPES.FILE_CHUNK) {
				handleFileChunk(message);
			} else if (message.type === MESSAGE_TYPES.CHUNK_ACK) {
				handleChunkAck(message);
			} else if (message.type === MESSAGE_TYPES.FILE_COMPLETE) {
				handleFileComplete(message.fileId);
			}
		} catch (err) {
			console.error("Error parsing incoming message:", err);
		}
	};

	const handleFileStart = (message: BinaryMessage) => {
		const { fileId, fileName, fileSize, totalChunks } = message;
		if (!fileName || fileSize === undefined || totalChunks === undefined)
			return;

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

	const handleFileChunk = (message: BinaryMessage) => {
		const { fileId, fileName, chunkIndex, totalChunks, fileSize, payload } =
			message;
		if (
			!fileName ||
			chunkIndex === undefined ||
			totalChunks === undefined ||
			fileSize === undefined ||
			!payload
		)
			return;

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
			buffer.receivedChunks.set(chunkIndex, payload);
			buffer.receivedCount++;
			buffer.lastReceivedTime = Date.now();

			const progress = (buffer.receivedCount / totalChunks) * 100;
			setTransferProgress(progress);
			setTransferStatus(`Receiving ${fileName}: ${Math.round(progress)}%`);

			const ack: BinaryMessage = {
				type: MESSAGE_TYPES.CHUNK_ACK,
				fileId,
				chunkIndex,
			};
			if (dataChannelRef.current?.readyState === "open") {
				dataChannelRef.current.send(encodeBinaryMessage(ack));
			}

			if (buffer.receivedCount === totalChunks) {
				assembleAndSaveFile(fileId);
			}
		}
	};

	const handleChunkAck = (message: BinaryMessage) => {
		const { fileId, chunkIndex } = message;
		if (chunkIndex === undefined || currentFileIdRef.current !== fileId) return;

		pendingChunksRef.current.delete(chunkIndex);
		const now = Date.now();
		const rtt = now - lastAckTimeRef.current;
		lastAckTimeRef.current = now;

		if (rtt < 50) {
			windowSizeRef.current = Math.min(
				windowSizeRef.current + 8,
				MAX_WINDOW_SIZE
			);
		} else if (rtt > 200) {
			windowSizeRef.current = Math.max(
				windowSizeRef.current - 4,
				MIN_WINDOW_SIZE
			);
		}

		if (isSendingRef.current) {
			processSendQueue();
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

		const blob = new Blob([completeFile],{ type: "application/octet-stream" });
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
			type: MESSAGE_TYPES.FILE_START,
			fileId,
			fileName: file.name,
			fileSize: file.size,
			totalChunks,
		};
		dataChannelRef.current.send(encodeBinaryMessage(startMessage));

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
					const completeMessage: BinaryMessage = {
						type: MESSAGE_TYPES.FILE_COMPLETE,
						fileId,
						fileName: file.name,
					};
					try {
						dataChannelRef.current!.send(encodeBinaryMessage(completeMessage));
						setTransferStatus(`File sent: ${file.name}`);
						setTransferProgress(100);
						setTimeout(() => {
							setTransferProgress(0);
							isSendingRef.current = false;
							currentFileIdRef.current = null;
							clearInterval(timeoutChecker);
							resolve();
						}, 200);
					} catch (error) {
						clearInterval(timeoutChecker);
						reject(error);
					}
				} else {
					setTimeout(checkComplete, 20);
				}
			};
			setTimeout(checkComplete, 20);
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
		if (bufferedAmount > MAX_BUFFER_SIZE *0.9) {
			setTimeout(processSendQueue, 5);  
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
				const message: BinaryMessage = {
					type: MESSAGE_TYPES.FILE_CHUNK,
					fileId: chunk.fileId,
					chunkIndex: chunk.chunkIndex,
					totalChunks: chunk.totalChunks,
					fileSize: chunk.fileSize,
					fileName: chunk.fileName,
					payload: chunk.data,
				};
				dataChannelRef.current.send(encodeBinaryMessage(message));
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
			setTimeout(processSendQueue, 2);
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
				windowSizeRef.current - 1,
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
