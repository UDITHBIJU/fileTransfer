export interface Peer {
	socketId: string;
	publicIp: string;
}
export interface Peers {
	[deviceId: string]: Peer;
}
