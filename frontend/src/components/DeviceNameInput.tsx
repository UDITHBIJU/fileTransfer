import React, { useState, useEffect } from "react";
import { useSocketContext } from "../context/socketProvider";
export const DeviceNameInput: React.FC = () => {
	const { socket, isConnected, error } = useSocketContext();
	const [deviceName, setDeviceName] = useState<string>("");
	const [nameError, setNameError] = useState<string | null>(null);

	useEffect(() => {
		const savedName = localStorage.getItem("deviceName");
		console.log("Saved device name:", savedName);
		if (savedName) {
			setDeviceName(savedName);
			if (isConnected && socket) {
				socket.emit("setDeviceName", savedName);
			}
		}
	}, [socket, isConnected]);

	const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setDeviceName(e.target.value);
		setNameError(null);
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		if (!isConnected || !socket) {
			setNameError("Not connected to server");
			return;
		}
		if (!deviceName || deviceName.length > 20) {
			setNameError("Name must be 1-20 characters");
			return;
		}
		localStorage.setItem("deviceName", deviceName);
		socket.emit("setDeviceName", deviceName);
		setNameError(null);
	};

	return (
		<div className="mb-4">
			<form onSubmit={handleSubmit} className="flex flex-col space-y-2">
				<label htmlFor="deviceNameInput" className="text-sm font-medium">
					Device Name:
				</label>
				<input
					id="deviceNameInput"
					type="text"
					value={deviceName}
					onChange={handleNameChange}
					placeholder="Enter device name (max 20 chars)"
					className="p-2 border rounded"
					maxLength={20}
				/>
				<button
					type="submit"
					disabled={!deviceName || !isConnected}
					className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
				>
					Set Name
				</button>
			</form>
			{nameError && <p className="text-red-600 mt-2">{nameError}</p>}
			{error && error.includes("name") && (
				<p className="text-red-600 mt-2">{error}</p>
			)}
		</div>
	);
};
