import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { SocketProvider } from "./context/socketProvider";
import FileTransfer  from "./components/Filetransfer"
const App: React.FC = () => {
	return (
		<SocketProvider> 
			<Router>
				<div className="container mx-auto p-4">
					<Routes>
						<Route path="/" element={<FileTransfer />} />
					</Routes>
				</div>
			</Router>
		</SocketProvider>
	);
};

export default App;
