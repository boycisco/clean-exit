import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeSnippetProps {
  code: string | object;
  language?: string;
  maxHeight?: string;
  allowCopy?: boolean;
}

export function CodeSnippet({
  code,
  maxHeight = 'max-h-60',
  allowCopy = true,
}: CodeSnippetProps) {
  const [copied, setCopied] = useState(false);

  const formattedCode =
    typeof code === 'object' ? JSON.stringify(code, null, 2) : String(code);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="relative group rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] overflow-hidden text-[12px]">
      {allowCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-[var(--radius-sm)] text-[11px] transition-colors z-10"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check size={12} className="text-[var(--accent)]" />
              <span className="text-[var(--accent)]">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      )}
      <pre
        className={`p-3 font-mono overflow-x-auto text-[var(--text-secondary)] ${maxHeight} leading-relaxed select-all`}
      >
        <code>{formattedCode}</code>
      </pre>
    </div>
  );
}
