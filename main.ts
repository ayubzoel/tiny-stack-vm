// Tiny stack virtual machine, written from ISA.md (tiny-stack-vm-01).
// One run answers every /input/<id>/ program: writes /output/<id>/stdout.bin
// (the exact bytes the program wrote) and /output/<id>/exit.txt (0-255).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IN_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const MAX_STEPS = 1000000;
const MAX_OUT = 65536;

function runProgram(prog, inp) {
  const D = new Int32Array(256); // data stack
  const C = new Int32Array(64); // return addresses
  const M = new Int32Array(256); // memory words
  const out = Buffer.alloc(MAX_OUT);
  let sp = 0, csp = 0, olen = 0, ipos = 0, pc = 0, steps = 0;
  const n = prog.length;
  const fin = (code) => ({ out: out.subarray(0, olen), code });
  for (;;) {
    // Trap order is the ISA's: step limit, then pc, then opcode, then immediate.
    if (steps === MAX_STEPS) return fin(10);
    if (pc < 0 || pc >= n) return fin(9);
    const op = prog[pc];
    let imm = 0, need = 0, give = 0;
    switch (op) {
      case 0x00: break;
      case 0x01: imm = 1; give = 1; break;
      case 0x02: imm = 4; give = 1; break;
      case 0x03: need = 1; break;
      case 0x04: need = 1; give = 2; break;
      case 0x05: need = 2; give = 2; break;
      case 0x06: need = 2; give = 3; break;
      case 0x07: need = 3; give = 3; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22:
        need = 2; give = 1; break;
      case 0x17: case 0x1b: need = 1; give = 1; break;
      case 0x30: imm = 2; break;
      case 0x31: case 0x32: imm = 2; need = 1; break;
      case 0x33: imm = 2; break;
      case 0x34: break;
      case 0x40: need = 1; give = 1; break;
      case 0x41: need = 2; break;
      case 0x50: case 0x51: case 0x53: need = 1; break;
      case 0x52: give = 1; break;
      default: return fin(5);
    }
    if (pc + 1 + imm > n) return fin(9);
    steps++;
    // Stack needs are checked before any effect of the instruction.
    if (sp < need) return fin(2);
    if (sp - need + give > 256) return fin(3);
    const nxt = pc + 1 + imm;
    pc = nxt;
    switch (op) {
      case 0x00: return fin(0);
      case 0x01: D[sp++] = (prog[nxt - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = prog[nxt - 4] | (prog[nxt - 3] << 8) | (prog[nxt - 2] << 16) | (prog[nxt - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1], a = D[sp - 2];
        let r = 0;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            if (b === 0) return fin(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14:
            if (b === 0) return fin(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15:
            if (b === 0) return fin(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            if (b === 0) return fin(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[nxt - 2] | (prog[nxt - 1] << 8)) << 16) >> 16;
        let go = true;
        if (op !== 0x30) {
          const v = D[--sp];
          go = op === 0x31 ? v === 0 : v !== 0;
        }
        if (go) pc = nxt + rel;
        break;
      }
      case 0x33:
        if (csp === 64) return fin(7);
        C[csp++] = nxt;
        pc = prog[nxt - 2] | (prog[nxt - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return fin(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr > 255) return fin(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1], v = D[sp - 2];
        if (addr < 0 || addr > 255) return fin(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (olen + s.length > MAX_OUT) return fin(11);
        sp--;
        olen += out.write(s, olen, "ascii");
        break;
      }
      case 0x51:
        if (olen + 1 > MAX_OUT) return fin(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ipos < inp.length ? inp[ipos++] : -1;
        break;
      case 0x53:
        return fin(D[--sp] & 255);
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const dir = join(IN_DIR, id);
  if (!statSync(dir).isDirectory()) continue;
  const prog = readFileSync(join(dir, "program.bin"));
  const inp = existsSync(join(dir, "input.bin")) ? readFileSync(join(dir, "input.bin")) : Buffer.alloc(0);
  const { out, code } = runProgram(prog, inp);
  const od = join(OUT_DIR, id);
  mkdirSync(od, { recursive: true });
  writeFileSync(join(od, "stdout.bin"), out);
  writeFileSync(join(od, "exit.txt"), code + "\n");
}
