// Cố gắng lấy phần JSON thuần từ phản hồi của LLM.
export const extractJsonText = (input: string): string => {
  const trimmed = input.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("LLM khong tra ve JSON hop le.");
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
};
