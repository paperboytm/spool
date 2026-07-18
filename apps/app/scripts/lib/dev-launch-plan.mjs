export const DEV_LAUNCH_PLAN = [
  {
    label: 'Electron workers',
    command: 'electron-vite',
    args: ['build', '--config', 'electron.workers.vite.config.ts'],
  },
  {
    label: 'Electron app',
    command: 'electron-vite',
    args: ['dev'],
  },
]
