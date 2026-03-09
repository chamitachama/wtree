import * as readline from 'readline'
import chalk from 'chalk'

export function pickService(services: string[]): Promise<string> {
  if (services.length === 1) return Promise.resolve(services[0])
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    console.log(chalk.blue('Which service?'))
    services.forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
    rl.question('> ', answer => {
      rl.close()
      const idx = parseInt(answer.trim(), 10) - 1
      resolve(services[idx >= 0 && idx < services.length ? idx : 0])
    })
  })
}
