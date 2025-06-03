import os from "os";

export function getNetworkIp(): string {
	const interfaces = os.networkInterfaces();

    //iterates over the interfaces which include eth0, wlan0, etc. 
	for (const iface of Object.values(interfaces)) {
        
		for (const alias of iface || []) {
			if (
				alias.family === "IPv4" &&
				!alias.internal &&
				alias.address != "127.0.0.1"
			) {
				return alias.address;
			}
		}
	}
	return "unknown";
}
