import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-4 text-xl font-bold text-gray-900 first:mt-0 dark:text-gray-100">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold text-gray-900 first:mt-0 dark:text-gray-100">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-base font-semibold text-gray-900 first:mt-0 dark:text-gray-100">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 last:mb-0 leading-relaxed text-gray-900 dark:text-gray-100">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed text-gray-900 dark:text-gray-100">
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900 dark:text-gray-100">
      {children}
    </strong>
  ),
  em: ({ children }) => (
    <em className="text-gray-600 dark:text-gray-400">{children}</em>
  ),
  hr: () => <hr className="my-4 border-gray-200 dark:border-gray-700" />,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-gray-200 pl-4 text-gray-600 dark:border-gray-600 dark:text-gray-400">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-gray-100 p-3 text-sm dark:bg-gray-800">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-gray-100 p-3 text-sm last:mb-0 dark:bg-gray-800">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-gray-100 dark:border-gray-800">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{children}</td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </a>
  ),
};

type MarkdownContentProps = {
  content: string;
};

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!content) return null;

  return (
    <div className="markdown-content text-[15px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
