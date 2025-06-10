import { Request, Response } from "express";
import { Server, Socket } from "socket.io";
import { Peer, Peers } from "../types/peer";
import { getNetworkIp } from "../utils/network";

const peers: Peers = {};

export function initializeSocketEvents(io: Server): void {
	io.on("connection", (socket: Socket) => {
		const clientIp =
			socket.handshake.headers["x-forwarded-for"]?.toString() ||
			socket.handshake.address ||
			"unknown";
		const deviceId = socket.handshake.query.deviceId as string;
		if (!deviceId) {
			socket.disconnect();
			return;
		}

		const existingPeer = Object.values(peers).find(
			(p) => p.deviceId === deviceId
		);
		if (existingPeer && existingPeer.socketId !== socket.id) {
			io.to(existingPeer.socketId).emit("error", {
				message: "New connection detected, disconnecting old session",
			});
			io.sockets.sockets.get(existingPeer.socketId)?.disconnect();
		}

		peers[deviceId] = {
			socketId: socket.id,
			publicIp: clientIp,
			deviceName: peers[deviceId]?.deviceName || "",
			deviceId,
		};

		const matchingSocketIds = findMatchingPeers(peers, deviceId, clientIp);
		socket.emit("peerList", matchingSocketIds);
		notifyMatchingPeers(io, matchingSocketIds, socket.id);

		io.emit("peersUpdated", peers);

		socket.on("setDeviceName", (name: string) => {
			if (
				!name ||
				typeof name !== "string" ||
				name.length > 20 ||
				name.length < 1
			) {
				socket.emit("nameError", { message: "Name must be 1-20 characters" });
				return;
			}
			const existingNames = Object.values(peers)
				.filter(
					(peer) =>
						peer.deviceName &&
						peer.deviceName !== "" &&
						peer.deviceId !== deviceId
				)
				.map((peer) => peer.deviceName);
			if (existingNames.includes(name)) {
				socket.emit("nameError", { message: "Device name already in use" });
				return;
			}
			peers[deviceId].deviceName = name;
			io.emit("peersUpdated", peers);
		});

		socket.on("requestPeerList", () => {
			const peerSocketIds = findMatchingPeers(peers, deviceId, clientIp);
			socket.emit("peerList", peerSocketIds);
		});

		socket.on(
			"offer",
			({ toDeviceId, offer }: { toDeviceId: string; offer: any }) => {
				const targetPeer = peers[toDeviceId];
				if (targetPeer) {
					io.to(targetPeer.socketId).emit("offer", {
						fromDeviceId: deviceId,
						offer,
					});
				}
			}
		);

		socket.on(
			"answer",
			({ toDeviceId, answer }: { toDeviceId: string; answer: any }) => {
				const targetPeer = peers[toDeviceId];
				if (targetPeer) {
					io.to(targetPeer.socketId).emit("answer", {
						fromDeviceId: deviceId,
						answer,
					});
				}
			}
		);

		socket.on(
			"ice-candidate",
			({ toDeviceId, candidate }: { toDeviceId: string; candidate: any }) => {
				const targetPeer = peers[toDeviceId];
				if (targetPeer) {
					io.to(targetPeer.socketId).emit("ice-candidate", {
						fromDeviceId: deviceId,
						candidate,
					});
				}
			}
		);

		socket.on("disconnect", () => {
			delete peers[deviceId];
			io.emit("peersUpdated", peers);
			const matchingSocketIds = findMatchingPeers(peers, deviceId, clientIp);
			matchingSocketIds.forEach((peerSocketId) => {
				io.to(peerSocketId).emit("peerLeft", socket.id);
			});
			io.emit("peersUpdated", peers);
		});
	});
}

export function findMatchingPeers(
	peers: Peers,
	deviceId: string,
	publicIp: string
): string[] {
	const matchingPeerIds = Object.entries(peers)
		.filter(([peerDeviceId, peer]) => {
			if (peerDeviceId === deviceId) return false;
			const peerIp = peer.publicIp;
			const isSameSubnet =
				peerIp.split(".").slice(0, 3).join(".") ===
				publicIp.split(".").slice(0, 3).join(".");

			return isSameSubnet;
		})
		.map(([_, peer]) => peer.socketId);

	return matchingPeerIds;
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

export function getPeers(peers: Peers, _: Request, res: Response): void {
	res.json(peers);
}

export function getRoot(req: Request, res: Response): void {
	res.json({ message: "Success" });
}
