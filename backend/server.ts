import express, { Request, Response } from "express";
import { Server } from "socket.io";
import cors from "cors";
import http from "http";

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
	},
});

// Store peers with their public IPs
const peers: { [deviceId: string]: { socketId: string; publicIp: string } } =
	{};

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", async (req: Request, res: Response) => {
	console.log("test");
	res.json({ message: "Hello from the server!" });
});

//socket.io connection listening for client which have socket.io
io.on("connection", (socket) => {
	const publicIp =
		socket.handshake.headers["x-forwarded-for"] ||
		socket.request.connection.remoteAddress ||
		"unknown";
	const deviceId = socket.handshake.query.deviceId as string;

	if (deviceId) {
		peers[deviceId] = { socketId: socket.id, publicIp: publicIp.toString() };
		console.log(
			`New connection: ${socket.id} from ${publicIp} ,device ${deviceId}`
		);
		console.log("Current peers:", peers);

		socket.on("disconnect", () => {
			console.log(`Peer disconnected: ${socket.id}`);
			delete peers[deviceId];
			console.log("Current peers after disconnect:", peers);
		});
	}else{
		console.log("Device ID not provided in handshake query");
		socket.disconnect();
	}
});

server.listen(4001, "0.0.0.0", () => {
	console.log("Server is running on port 4001");
});
