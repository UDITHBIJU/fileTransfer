
import express, { Request, Response } from "express";
import { Server } from "socket.io";
import cors from "cors";
import http from "http";
import { initializeSocketEvents } from "./controllers/peerController";
import { setupRoutes } from "./routes/api";
import { Peers } from "./types/peer";

const app = express();



const  server = http.createServer(app);

const allowedOrigins = [
	"https://file-transfer-sand.vercel.app", 
	"http://192.168.1.77:5173",
	"http://localhost:5173",
];

app.use(
	cors({
		origin: allowedOrigins,
		methods: ["GET", "POST", "OPTIONS"],
		allowedHeaders: ["Content-Type"],
		credentials: false,
	})
);


app.use(express.urlencoded({ extended: false }));
app.use(express.json());

  const io = new Server(server, {
		cors: {
			origin: allowedOrigins,
			methods: ["GET", "POST", "OPTIONS"],
			allowedHeaders: ["Content-Type"],
			credentials: false,
		},
		transports: ["websocket", "polling"],
	});
	try{
io.on("connection", (socket) => {
	console.log(
		`Socket.IO client connected: ${socket.id} with deviceId: ${
			socket.handshake.query.deviceId
		} at ${new Date().toISOString()}`
	);
	socket.on("disconnect", () => {
		console.log(
			`Socket.IO client disconnected: ${
				socket.id
			} at ${new Date().toISOString()}`
		);
	});
	socket.on("error", (err) => {
		console.error(
			`Socket.IO error for ${socket.id}: ${
				err.message
			} at ${new Date().toISOString()}`
		);
	});
});}
catch (error) {
	console.error("Error initializing Socket.IO:", error);
}

const peers: Peers = {};
initializeSocketEvents(io);
app.use("/api", setupRoutes(peers));

const port = parseInt(process.env.PORT || "4001", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
});
