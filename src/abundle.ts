#!/usr/bin/env bun
import path from "path";
import fs from "fs";
import {
  AssetBundleInput,
  decodeAssetBundle,
  decodeAssetBundleStream,
  encodeAssetBundle,
} from "./AssetBundle";

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const force = process.argv.includes("-f") || process.argv.includes("--force");

function readdirRecursiveSync(dir: string): string[] {
  const files = fs.readdirSync(dir);
  return files.flatMap((file) => {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      return readdirRecursiveSync(full);
    }
    return full;
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KiB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

const operation = args[0];
if (!operation) {
  console.log(`abundle: create and extract asset bundles`);
  console.log(``);
  console.log(`- abundle pack <inputs...> <bundle>`);
  console.log(`- abundle unpack <bundle> <outdir>`);
  console.log(`- abundle ls <bundle>`);
  console.log(`- abundle read <bundle> <file> [output = stdout]`);
  console.log(`- abundle verify <bundle>`);
  process.exit(1);
}
if (operation === "pack") {
  if (args.length <= 2) {
    console.error(`Usage: abundle pack <inputs...> <bundle>`);
    process.exit(1);
  }
  const inputs = args.slice(1, -1).map((x) => path.resolve(x));
  for (const file of inputs) {
    if (!fs.existsSync(file)) {
      console.error(`Input "${file}" does not exist.`);
      process.exit(1);
    }
  }
  let output: number = 1;
  let outputPath: string | null = null;
  try {
    if (args.at(-1) !== "-") {
      outputPath = path.resolve(args.at(-1)!);
      if (fs.existsSync(outputPath) && !force) {
        console.error(
          `Output file "${outputPath}" already exists.\nPass -f / --force to overwrite.`
        );
        process.exit(1);
      }
      output = fs.openSync(outputPath, "w");
    }

    const resolvedInputs = inputs.flatMap((x) =>
      fs.statSync(x).isDirectory() ? readdirRecursiveSync(x) : x
    );

    const root = resolvedInputs.reduce<string | null>((acc, file) => {
      // return the common root of all files
      const dir = path.dirname(file);
      if (acc === null) {
        return dir;
      }
      const accParts = acc.split(path.sep);
      const dirParts = dir.split(path.sep);
      const min = Math.min(accParts.length, dirParts.length);
      let i = 0;
      while (i < min && accParts[i] === dirParts[i]) {
        i++;
      }
      return accParts.slice(0, i).join(path.sep);
    }, null)!;

    const files: AssetBundleInput[] = [];
    for (const file of resolvedInputs) {
      files.push({
        name: path.relative(root, file),
        data: fs.readFileSync(file),
      });
    }

    const blob = await encodeAssetBundle(files);
    const arrayBuffer = await blob.arrayBuffer();
    fs.writeSync(output, Buffer.from(arrayBuffer));
    if (outputPath) {
      fs.closeSync(output);
      output = 1;
    }
    let logFinal = outputPath ? console.log : console.error;

    logFinal(
      `Wrote ${files.length} files to ${
        outputPath ? path.relative(process.cwd(), outputPath) : "stdout"
      }`
    );
    logFinal(`Total size: ${formatSize(blob.size)} bytes`);
    logFinal(`Took ${Math.ceil(performance.now())}ms`);
  } catch (e) {
    if (output !== 1) {
      fs.closeSync(output);
      fs.unlinkSync(outputPath!);
    }
    throw e;
  }
} else if (operation === "verify") {
  const file = path.resolve(args[1]);
  if (!fs.existsSync(file)) {
    console.error(`File "${file}" does not exist.`);
    process.exit(1);
  }
  try {
    await decodeAssetBundle(fs.readFileSync(file));
  } catch (e) {
    console.error(`File "${file}" is not a valid asset bundle.`);
  }
  console.log(`Valid asset bundle`);
} else if (operation === "read") {
  const file = path.resolve(args[1]);
  if (!fs.existsSync(file)) {
    console.error(`File "${file}" does not exist.`);
    process.exit(1);
  }
  try {
    for await (const entry of decodeAssetBundleStream(Bun.file(file))) {
      if (entry.name === args[2]) {
        const buffer = await entry.data.arrayBuffer();
        fs.writeFileSync(args[3] ?? 1, Buffer.from(buffer));
        process.exit(0);
      }
    }
  } catch (e) {
    console.error(`File "${file}" is not a valid asset bundle.`);
  }
} else if (operation === "ls") {
  const file = path.resolve(args[1]);
  if (!fs.existsSync(file)) {
    console.error(`File "${file}" does not exist.`);
    process.exit(1);
  }
  try {
    for await (const entry of decodeAssetBundleStream(Bun.file(file))) {
      console.log(entry.name);
    }
  } catch (e) {
    console.error(`File "${file}" is not a valid asset bundle.`);
  }
} else {
  console.error(`Unknown operation "${operation}"`);
  process.exit(1);
}
