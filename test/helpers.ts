export const msgs = (d: { message: string }[]): string => d.map((x) => x.message).join("\n");
