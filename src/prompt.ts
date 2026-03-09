import * as readline from 'readline'
import chalk from 'chalk'

export function confirmDelete(name: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    console.log(chalk.yellow(`⚠️  This will permanently delete workspace "${name}" and its worktree.`))
    rl.question('Type DELETE to confirm: ', answer => {
      rl.close()
      resolve(answer.trim() === 'DELETE')
    })
  })
}
