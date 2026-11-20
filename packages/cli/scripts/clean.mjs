// Cross-platform `rm -rf dist` (the shell one-liner does not exist in cmd.exe).
import { rmSync } from 'fs'
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true })
