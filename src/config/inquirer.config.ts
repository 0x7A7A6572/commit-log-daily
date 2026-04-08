import chalk from "chalk";

export const listTheme: unknown = {
  icon: { cursor: chalk.green.bold("➜ ") },
  style: {
    message: (text: string) => chalk.blue(text),
    highlight: (text: string) => chalk.green.bold(text),
    description: (text: string) => chalk.bgWhite.grey(` ${text} `),
  },
};
