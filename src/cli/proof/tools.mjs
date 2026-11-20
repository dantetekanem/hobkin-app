import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * The TLA+ tools hobkin runs (_specs/050-tla-proofs). TLC and SANY come from tla2tools.jar, pinned to v1.7.4, the last
 * stable release (https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4). That release page publishes only a sha1.
 * The sha256 was taken from a download whose sha1 matched, and setup checks both.
 */
export const TLA2TOOLS = {
  version: '1.7.4',
  url: 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar',
  sha1: 'bee4a54f3ee3d4afc347c3240ec2d9e93b075104',
  sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88',
  bytes: 2274532,
};

/** TLC needs Java 11 or newer (https://docs.tlapl.us/using:tlc:start). */
export const MINIMUM_JAVA = 11;

/**
 * The Java runtime setup installs on a Mac without one: Eclipse Temurin's JRE 21 build for each chip, pinned to a release
 * with the sha256 Adoptium lists for it (https://api.adoptium.net/v3/assets/release_name/eclipse/jdk-21.0.13.1%2B2).
 * It lives in hobkin's home, so it needs no admin password and no Homebrew, and changes nothing else on the Mac.
 */
const TEMURIN = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2';
export const JAVA_RUNTIME = {
  version: '21.0.13.1+2',
  major: 21,
  builds: {
    arm64: { url: `${TEMURIN}/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.13.1_2.tar.gz`, sha256: '848feb1906c7de79de4f8391636042193fbd46eff86e26299506c4656f62c260', bytes: 47946379 },
    x64: { url: `${TEMURIN}/OpenJDK21U-jre_x64_mac_hotspot_21.0.13.1_2.tar.gz`, sha256: '10cee6ba4cd83fd4613a3f0bb3ef9dddd68c68d5f3ccfcc7e456707c9e1eafe0', bytes: 41907486 },
  },
};

// `java -version` answers at once, but a cold JVM can take a few seconds.
const ASK_MS = 15000;

export const jarPath = home => join(home, 'tools', 'tla', 'tla2tools.jar');
export const tlapsFolder = home => join(home, 'tools', 'tlaps');
/** Where setup unpacks its Java runtime: the archive's one folder, a macOS bundle, becomes `tools/java`. */
export const javaFolder = home => join(home, 'tools', 'java');
export const ownJava = home => join(javaFolder(home), 'Contents', 'Home', 'bin', 'java');

const run = promisify(execFile);
const defaultExec = (command, args) => run(command, args, { timeout: ASK_MS });

/** `version "21.0.2"`, `version "1.8.0_392"` or `openjdk 21.0.2`: the major is the first number, or the second after 1. */
function javaVersion(text) {
  const version = text.match(/version "([^"]+)"/)?.[1] ?? text.match(/^\S+ (\d+[\d.]*)/m)?.[1];
  if (!version) return null;
  const [first, second] = version.split(/[._-]/).map(Number);
  return { version, major: first === 1 ? second : first };
}

async function askJava(exec, path) {
  try {
    const { stdout = '', stderr = '' } = await exec(path, ['-version']);
    return javaVersion(`${stderr}\n${stdout}`.trim());
  } catch {
    return null;
  }
}

/** Where a JDK may be: JAVA_HOME, then the one setup installed in hobkin's home, then the one macOS's java_home picks, then `java` on the PATH. */
async function javaCandidates({ home, env, platform, exec }) {
  const candidates = [];
  if (env.JAVA_HOME) candidates.push(join(env.JAVA_HOME, 'bin', 'java'));
  if (home && existsSync(ownJava(home))) candidates.push(ownJava(home));
  if (platform === 'darwin') {
    try {
      const { stdout } = await exec('/usr/libexec/java_home', []);
      if (stdout.trim()) candidates.push(join(stdout.trim(), 'bin', 'java'));
    } catch {
      // No JDK: macOS's java_home fails the same way its /usr/bin/java stub does.
    }
  }
  candidates.push('java');
  return candidates;
}

/** The first Java that runs, with its version. Too old or missing gives the reason in a line instead. */
export async function findJava({ home, env = process.env, platform = process.platform, exec = defaultExec } = {}) {
  for (const path of await javaCandidates({ home, env, platform, exec })) {
    const found = await askJava(exec, path);
    if (!found) continue;
    if (found.major < MINIMUM_JAVA) return { path: null, problem: `Java ${found.major} is too old. TLC needs Java ${MINIMUM_JAVA} or newer.` };
    return { path, ...found };
  }
  return { path: null, problem: `Java is not installed. TLC needs Java ${MINIMUM_JAVA} or newer.` };
}

/** tlapm in hobkin's tools folder, then on the PATH. Only looked for, never run. */
export function findTlapm(home, { env = process.env } = {}) {
  const folders = [join(tlapsFolder(home), 'bin'), tlapsFolder(home), ...(env.PATH ?? '').split(delimiter).filter(Boolean)];
  return folders.map(folder => join(folder, 'tlapm')).find(path => existsSync(path)) ?? null;
}

/** What setup reports and a check uses: Java with its version, the pinned jar and tlapm. */
export async function inspectTools(home, options = {}) {
  const jar = jarPath(home);
  return {
    java: await findJava({ home, ...options }),
    jar: existsSync(jar) ? jar : null,
    tlapm: findTlapm(home, options),
  };
}

/** The tools as the window's setup button reads them (`ProofTools`): each one's path, or null when missing. */
export async function findTools(home, options = {}) {
  const { java, jar, tlapm } = await inspectTools(home, options);
  return { java: java.path, tlc: jar, tlaps: tlapm };
}
