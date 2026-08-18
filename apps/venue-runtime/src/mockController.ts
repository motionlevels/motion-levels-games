import { createServer, type Server, type Socket } from "node:net";
import {
  controllerProtocolVersion,
  encodeControllerMessage,
  encodeDelimited,
  floorHeight,
  floorWidth
} from "./controllerProtocol.ts";

export type MockControllerServerOptions = {
  host?: string;
  port?: number;
  adapterRevision?: string;
  refreshFps?: number;
  log?: (message: string) => void;
};

export function startMockControllerServer(options: MockControllerServerOptions = {}): {
  server: Server;
  close: () => Promise<void>;
} {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4201;
  const adapterRevision = options.adapterRevision ?? "mock-controller-v2";
  const refreshFps = options.refreshFps ?? 50;
  const log = options.log ?? ((msg) => console.log(`[mock-controller] ${msg}`));

  const sockets = new Set<Socket>();

  const helloMessage = encodeDelimited(encodeControllerMessage({
    type: "hello",
    hello: {
      protocolVersion: controllerProtocolVersion,
      adapterRevision,
      width: floorWidth,
      height: floorHeight,
      refreshFps
    }
  }));

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);

    socket.write(helloMessage);

    socket.on("error", () => {
      sockets.delete(socket);
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  server.listen(port, host, () => {
    log(`Listening at tcp://${host}:${port}`);
  });

  return {
    server,
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    })
  };
}
