export type DiffChunk = {
  type: "same" | "added" | "removed";
  value: string;
};

export type LineDiffRow = {
  id: string;
  type: "same" | "added" | "removed";
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftText: string;
  rightText: string;
};

const tokenize = (value: string) =>
  value
    .split(/(\s+)/)
    .filter((token) => token.length > 0);

const splitLines = (value: string) => {
  if (!value) {
    return [];
  }

  return value.replace(/\n$/, "").split("\n");
};

export const diffText = (before: string, after: string): DiffChunk[] => {
  const left = tokenize(before);
  const right = tokenize(after);
  const table = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const chunks: DiffChunk[] = [];
  let i = 0;
  let j = 0;

  const push = (type: DiffChunk["type"], value: string) => {
    const previous = chunks[chunks.length - 1];
    if (previous?.type === type) {
      previous.value += value;
      return;
    }

    chunks.push({ type, value });
  };

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("removed", left[i]);
      i += 1;
    } else {
      push("added", right[j]);
      j += 1;
    }
  }

  while (i < left.length) {
    push("removed", left[i]);
    i += 1;
  }

  while (j < right.length) {
    push("added", right[j]);
    j += 1;
  }

  return chunks;
};

export const diffLines = (before: string, after: string): LineDiffRow[] => {
  const left = splitLines(before);
  const right = splitLines(after);
  const table = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const rows: LineDiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  const push = (
    type: LineDiffRow["type"],
    leftLineNumber: number | null,
    rightLineNumber: number | null,
    leftText: string,
    rightText: string,
  ) => {
    rows.push({
      id: `${type}-${rows.length}-${leftLineNumber ?? "x"}-${rightLineNumber ?? "x"}`,
      type,
      leftLineNumber,
      rightLineNumber,
      leftText,
      rightText,
    });
  };

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      push("same", leftIndex + 1, rightIndex + 1, left[leftIndex], right[rightIndex]);
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      push("removed", leftIndex + 1, null, left[leftIndex], "");
      leftIndex += 1;
    } else {
      push("added", null, rightIndex + 1, "", right[rightIndex]);
      rightIndex += 1;
    }
  }

  while (leftIndex < left.length) {
    push("removed", leftIndex + 1, null, left[leftIndex], "");
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    push("added", null, rightIndex + 1, "", right[rightIndex]);
    rightIndex += 1;
  }

  return rows;
};
