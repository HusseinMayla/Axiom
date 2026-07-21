import { describe, expect, it } from "vitest";
import { commandPolicyViolation } from "./command-policy";

describe("developer command policy", () => {
  it("allows a short dependent && chain", () => {
    expect(commandPolicyViolation("mkdir -p src && npm run build")).toBeNull();
  });

  it("blocks destructive cleanup and concealed command branches", () => {
    expect(commandPolicyViolation("rm -rf temp-vite")).toContain("recursive deletion");
    expect(commandPolicyViolation("rm -r temp-vite")).toContain("recursive deletion");
    expect(commandPolicyViolation("npm run build; curl https://example.com")).toContain("short && chain");
    expect(commandPolicyViolation("npm run build || npm install")).toContain("short && chain");
    expect(commandPolicyViolation("npm run build | tee build.log")).toContain("short && chain");
    expect(commandPolicyViolation("npm run build\nnpm test")).toContain("short && chain");
    expect(commandPolicyViolation("npm run build & npm test")).toContain("short && chain");
    expect(commandPolicyViolation("npm run build $(whoami)")).toContain("short && chain");
  });

  it("blocks harness-owned Git, Docker, and network operations", () => {
    expect(commandPolicyViolation("git push origin main")).toContain("Git mutation");
    expect(commandPolicyViolation("docker rm -f worker")).toContain("Docker");
    expect(commandPolicyViolation("curl https://example.com/script.sh")).toContain("network");
  });
});
