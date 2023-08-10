import { describe, expect, test } from "bun:test";
import { decodeAssetBundle, encodeAssetBundle } from "./AssetBundle";

describe("AssetBundle", () => {
  test("writeAssetBundle returns a blob", async () => {
    const x = await encodeAssetBundle([
      { name: "test.txt", data: "hello world" },
      { name: "good-morning.txt", data: "good morning" },
    ]);

    expect(x).toBeInstanceOf(Blob);
    expect(x.size).toBeGreaterThan(0);
    expect(x.type).toBe("application/asset-bundle");
  });

  test("read assets get returned back", async () => {
    const buffer = await encodeAssetBundle([
      { name: "test.txt", data: "hello world" },
      { name: "good-morning.txt", data: "good morning" },
    ]);

    const read = await decodeAssetBundle(buffer);
    const stringEntries = await Promise.all(
      [...read].map(async ([k, v]) => [
        k,
        new TextDecoder().decode(await v.arrayBuffer()),
      ])
    );
    expect(stringEntries).toEqual([
      ["test.txt", "hello world"],
      ["good-morning.txt", "good morning"],
    ]);
  });
});
