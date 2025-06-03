
import React, { createContext, useContext } from "react";
import {type ReactNode } from "react";
import { useSocket } from "../hooks/useSocket";
import { type Peer } from "../utils/types";
import { Socket } from "socket.io-client";
import type { JSX } from "react/jsx-runtime";

interface SocketContextType {
	socket: Socket | null;
	isConnected: boolean;
	socketId: string | null;
	peers: { [id: string]: Peer };
	peerSocketIds: string[];
	apiResponse: any | null;
	error: string | null;
	backendIp: string | undefined;
	handleIpChange: (ip: string | undefined) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider = ({
	children,
}: {
	children: ReactNode;
}): JSX.Element => {
	const {
		socket,
		isConnected,
		socketId,
		peers,
		peerSocketIds,
		apiResponse,
		error,
		backendIp,
		handleIpChange,
	} = useSocket();

	return (
		<SocketContext.Provider
			value={{
				socket,
				isConnected,
				socketId,
				peers,
				peerSocketIds,
				apiResponse,
				error,
				backendIp,
				handleIpChange,
			}}
		>
			{children}
		</SocketContext.Provider>
	);
};

export const useSocketContext = (): SocketContextType => {
	const context = useContext(SocketContext);
	if (!context) {
		throw new Error("useSocketContext must be used within a SocketProvider");
	}
	return context;
};
