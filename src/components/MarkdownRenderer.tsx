import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { NITRO_EMOJIS } from '../../shared/constants.ts';

interface MarkdownRendererProps {
  content: string;
}

const CodeBlock: React.FC<{ lang: string; codeBody: string }> = ({ lang, codeBody }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(codeBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/10 bg-[#0D0F12]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#14171E] px-3 py-1.5 text-[11px] font-mono text-slate-400">
        <span>{lang || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs font-mono text-slate-200 leading-5">
        <code>{codeBody}</code>
      </pre>
    </div>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-1 text-[14.5px] leading-relaxed text-slate-200 break-words">
      {segments.map((seg, idx) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const lang = firstNewline > 0 ? inner.slice(0, firstNewline).trim() : 'code';
          const codeBody = firstNewline > 0 ? inner.slice(firstNewline + 1) : inner;
          return <CodeBlock key={idx} lang={lang} codeBody={codeBody} />;
        }

        const lines = seg.split('\n');
        return (
          <div key={idx} className="space-y-0.5">
            {lines.map((line, lIdx) => {
              if (line.startsWith('### ')) {
                return (
                  <h4 key={lIdx} className="font-display text-sm font-bold text-white pt-1">
                    {renderInline(line.slice(4))}
                  </h4>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h3 key={lIdx} className="font-display text-base font-bold text-white pt-1">
                    {renderInline(line.slice(3))}
                  </h3>
                );
              }
              if (line.startsWith('# ')) {
                return (
                  <h2 key={lIdx} className="font-display text-lg font-bold text-white pt-1">
                    {renderInline(line.slice(2))}
                  </h2>
                );
              }
              if (line.startsWith('> ')) {
                return (
                  <div
                    key={lIdx}
                    className="my-1 rounded-lg border border-white/10 bg-[#12151A] px-3 py-1.5 text-slate-300"
                  >
                    {renderInline(line.slice(2))}
                  </div>
                );
              }
              if (line.startsWith('- ') || line.startsWith('* ')) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                    <span>{renderInline(line.slice(2))}</span>
                  </div>
                );
              }
              return (
                <p key={lIdx} className="min-h-[1.25rem]">
                  {renderInline(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

function renderInline(text: string): React.ReactNode[] {
  let processed = text;
  for (const ne of NITRO_EMOJIS) {
    processed = processed.replaceAll(ne.code, ne.label);
  }

  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s]+|@[a-zA-Z0-9_.\-]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(processed)) !== null) {
    if (match.index > lastIndex) {
      parts.push(processed.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={match.index} className="rounded bg-[#0D0F12] px-1.5 py-0.5 font-mono text-xs text-indigo-300 border border-white/10">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={match.index} className="italic text-slate-200">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      parts.push(
        <a
          key={match.index}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#818CF8] underline decoration-[#818CF8]/40 underline-offset-2 hover:text-indigo-300"
        >
          {token}
        </a>
      );
    } else if (token.startsWith('@')) {
      parts.push(
        <span key={match.index} className="rounded bg-[#5865F2]/20 px-1 py-0.5 font-medium text-[#A5B4FC]">
          {token}
        </span>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < processed.length) {
    parts.push(processed.slice(lastIndex));
  }
  return parts;
}
