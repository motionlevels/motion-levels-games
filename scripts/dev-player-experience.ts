import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

children.push(spawn(npm, ["run", "dev", "--workspace", "@motion-levels-games/playground", "--", "--host", "127.0.0.1", "--port", "4104", "--strictPort"], {
  env: process.env,
  stdio: "inherit",
}));
children.push(spawn(npm, ["run", "dev", "--workspace", "@motion-levels-games/player-menu"], {
  env: {
    ...process.env,
    VITE_LOCAL_PLAYGROUND_PORT: "4104",
    VITE_POSTHOG_ENABLED: "false",
  },
  stdio: "inherit",
}));

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const result = await Promise.race(children.map((child) => new Promise<number>((resolve) => {
  child.once("exit", (code) => resolve(code ?? 1));
})));
stop();
process.exitCode = result;
