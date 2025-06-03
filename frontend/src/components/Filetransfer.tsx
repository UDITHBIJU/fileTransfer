import React from "react";
import ConnectionStatus from "./ConnectionStatus";
import PeerList from "./PeerList";
import { FileTransferForm } from "./FileTransferForm";
import { DeviceNameInput } from "./DeviceNameInput";
import { useSocketContext } from "../context/socketProvider";
const FileTransfer: React.FC = () => {
	const { peers, peerSocketIds, error } =
		useSocketContext();

	return (
		<div className="p-4 max-w-2xl mx-auto">
			<h1 className="text-2xl font-bold mb-4">File Transfer</h1>
			{error && !error.includes("name") && (
				<p className="text-red-600 mb-2 font-medium">{error}</p>
			)}
			<DeviceNameInput />

			<ConnectionStatus />
			<PeerList />
			<FileTransferForm peerSocketIds={peerSocketIds} peers={peers} />
		</div>
	);
};

export default FileTransfer;
