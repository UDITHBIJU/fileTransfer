import { Request, Response } from "express";
import { Server, Socket } from "socket.io";
import { Peer, Peers } from "../types/peer";
import { getNetworkIP } from "../utils/network";

const peers: Peers = {};

export function initializeSocketEvents(io: Server): void {
	io.on("connection", (socket: Socket) => {
		const publicIpRaw =
			socket.handshake.headers["x-forwarded-for"] ||
			socket.request.connection.remoteAddress ||
			"unknown";

		const publicIp =
			publicIpRaw === "127.0.0.0" || publicIpRaw === "::1"
				? getNetworkIP()
				: publicIpRaw.toString();

		const deviceId = socket.handshake.query.deviceId as string;

		if (!deviceId) {
			console.log(
				`Connection rejected: ${socket.id} missing deviceId`,
				socket.handshake.query
			);
			socket.disconnect();
			return;
		}

		peers[deviceId] = { socketId: socket.id, publicIp };
        
		console.log(
			`New connection: ${socket.id} from ${publicIp}, device ${deviceId}`
		);

		const matchingSocketIds = findMatchingPeers(peers, deviceId, publicIp);
		socket.emit("peerList", matchingSocketIds);
		notifyMatchingPeers(io, matchingSocketIds, socket.id);

		io.emit("peersUpdated", peers);

		socket.on(
			"sendMessage",
			({ toDeviceId, message }: { toDeviceId: string; message: string }) => {
				console.log(`Message from ${deviceId} to ${toDeviceId}: ${message}`);
				const targetPeer = peers[toDeviceId];
				if (targetPeer) {
					io.to(targetPeer.socketId).emit("receiveMessage", {
						from: deviceId,
						message,
					});
				}
			}
		);
		socket.on("disconnect", () => {
			console.log(`Peer disconnected: ${socket.id}`);
			const disconnectedIp = peers[deviceId]?.publicIp;
			io.emit("peersUpdated", peers);
			if (disconnectedIp) {
				const matchingSocketIds = findMatchingPeers(
					peers,
					deviceId,
					disconnectedIp
				);
				matchingSocketIds.forEach((peerSocketId) => {
					io.to(peerSocketId).emit("peerLeft", socket.id);
				});
			}
			delete peers[deviceId];
			io.emit("peersUpdated", peers);
		});
	});
}

export function findMatchingPeers(
	peers: Peers,
	deviceId: string,
	publicIp: string
): string[] {
	return Object.entries(peers)
		.filter(
			([peerDeviceId, peer]) =>
				peerDeviceId !== deviceId && peer.publicIp === publicIp
		)
		.map(([_, peer]) => peer.socketId);
}

export function notifyMatchingPeers(
	io: Server,
	matchingSocketIds: string[],
	newSocketId: string
): void {
	matchingSocketIds.forEach((socketId) => {
		io.to(socketId).emit("peerJoined", newSocketId);
	});
}
export function getPeers(peer:Peers,req: Request, res: Response): void {
    res.json(peers);
}
export function getRoot(req: Request, res: Response): void {
    console.log("Root endpoint hit");
    res.json({ message: "Hello from the server!" });
}
