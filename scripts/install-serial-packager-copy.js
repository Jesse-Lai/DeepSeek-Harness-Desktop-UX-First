import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readlink,
  readdir,
  stat,
  symlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import gracefulFs from "graceful-fs";

async function copyPathSerial(source, destination, options) {
  if (options.filter && !(await options.filter(source, destination))) return;

  const sourceStat = options.dereference ? await stat(source) : await lstat(source);

  if (sourceStat.isDirectory()) {
    if (!options.recursive) {
      throw new Error(`Recursive copy is required for directory: ${source}`);
    }
    await mkdir(destination, { recursive: true, mode: sourceStat.mode });
    for (const entry of await readdir(source)) {
      await copyPathSerial(
        resolve(source, entry),
        resolve(destination, entry),
        options,
      );
    }
    await chmod(destination, sourceStat.mode);
    return;
  }

  await mkdir(dirname(destination), { recursive: true });

  if (sourceStat.isSymbolicLink()) {
    await symlink(await readlink(source), destination);
    return;
  }

  if (!sourceStat.isFile()) {
    throw new Error(`Unsupported application file type: ${source}`);
  }

  await copyFile(
    source,
    destination,
    options.force === false ? constants.COPYFILE_EXCL : 0,
  );
  await chmod(destination, sourceStat.mode);
}

export function installSerialPackagerCopy(projectRoot) {
  const resolvedProjectRoot = resolve(projectRoot);
  const nativeCopy = gracefulFs.promises.cp;

  gracefulFs.promises.cp = async (source, destination, options = {}) => {
    if (resolve(source) === resolvedProjectRoot && options.recursive) {
      return copyPathSerial(source, destination, options);
    }
    return nativeCopy(source, destination, options);
  };

  return () => {
    gracefulFs.promises.cp = nativeCopy;
  };
}
