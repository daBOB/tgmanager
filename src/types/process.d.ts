declare namespace NodeJS {
  interface Process {
    pkg?: {
      entrypoint: string;
      defaultEntrypoint: string;
    };
  }
}