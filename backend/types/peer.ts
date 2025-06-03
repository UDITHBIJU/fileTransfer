export interface Peer {
	socketId: string;
	publicIp: string;
	deviceName: string;
	deviceId: string;
}

export interface Peers {
	[deviceId: string]: Peer;
}
