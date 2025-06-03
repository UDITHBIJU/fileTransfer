// hooks/useSocket.ts
import { useState, useRef, useEffect } from "react";
import io, { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import { type Peer } from "../utils/types";

export const useSocket = () => {
	const [isConnected, setIsConnected] = useState(false);
	const [socketId, setSocketId] = useState<string | null>(null);
	const [socket, setSocket] = useState<Socket | null>(null);
	const [peers, setPeers] = useState<{ [id: string]: Peer }>({});
	const [peerSocketIds, setPeerSocketIds] = useState<string[]>([]);
	const [backendIp, setBackendIp] = useState<string>(window.location.hostname);
	const [apiResponse, setApiResponse] = useState<any | null>(null);
	const [error, setError] = useState<string | null>(null);
	const reconnectAttempts = useRef(0);

	useEffect(() => {
		const deviceId =
			localStorage.getItem("deviceId") ||
			(() => {
				const newId = uuidv4();
				localStorage.setItem("deviceId", newId);
				return newId;
			})();

		const protocol = window.location.protocol === "https:" ? "https" : "http";
		const backendUrl = `${protocol}://${backendIp}:4001`;

		const newSocket: Socket = io(backendUrl, {
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
			timeout: 10000,
			query: { deviceId },
		});

		setSocket(newSocket);

		newSocket.on("connect", () => {
			setIsConnected(true);
			setSocketId(newSocket.id || null);
			setError(null);
			reconnectAttempts.current = 0;

			setTimeout(() => {
				newSocket.emit("requestPeerList");
				const savedName = localStorage.getItem("deviceName");
				if (savedName) {
					newSocket.emit("setDeviceName", savedName);
				}
			}, 500);

			fetch(`${backendUrl}/api/`)
				.then((res) => res.json())
				.then(setApiResponse)
				.catch(() => setError("Failed to fetch API"));
		});

		newSocket.on("connect_error", (err: Error) => {
			setError(`Connection error: ${err.message}`);
			reconnectAttempts.current++;
			if (reconnectAttempts.current >= 5) {
				setIsConnected(false);
			}
		});

		newSocket.on("disconnect", () => {
			setIsConnected(false);
			setSocketId(null);
		});

		newSocket.on("peerList", (socketIds: string[]) => {
			if (Array.isArray(socketIds)) {
				const filtered = socketIds.filter((id) => id !== newSocket.id);
				setPeerSocketIds(filtered);
			} else {
				setError("Invalid peer list received");
			}
		});

		newSocket.on("peerJoined", (peerId: string) => {
			if (peerId !== newSocket.id) {
				setPeerSocketIds((prev) =>
					prev.includes(peerId) ? prev : [...prev, peerId]
				);
			}
		});

		newSocket.on("peerLeft", (peerId: string) => {
			setPeerSocketIds((prev) => prev.filter((id) => id !== peerId));
		});

		newSocket.on("peersUpdated", (updatedPeers: { [id: string]: Peer }) => {
			if (updatedPeers && typeof updatedPeers === "object") {
				setPeers(updatedPeers);
			} else {
				setError("Invalid peers data");
			}
		});

		newSocket.on("nameError", (err: { message: string }) => {
			setError(err.message);
		});

		newSocket.on("error", (err: { message: string }) => {
			setError(err.message);
			if (err.message.includes("New connection detected")) {
				localStorage.removeItem("deviceName");
			}
		});

		newSocket.on("receiveFile", ({ fromDeviceId, fileData, fileName }) => {
			try {
				const file = new Blob([fileData]);
				const url = window.URL.createObjectURL(file);
				const a = document.createElement("a");
				a.href = url;
				a.download = fileName;
				a.click();
				window.URL.revokeObjectURL(url);
			} catch {
				setError("Error receiving file");
			}
		});

		return () => {
			newSocket.disconnect();
			setSocket(null);
		};
	}, [backendIp]);

	const handleIpChange = (ip: string | undefined) => {
		if (socket) {
			socket.disconnect();
		}
		setBackendIp(ip || window.location.hostname);
	};

	return {
		isConnected,
		socketId,
		socket,
		peers,
		peerSocketIds,
		backendIp,
		handleIpChange,
		apiResponse,
		error,
	};
};
