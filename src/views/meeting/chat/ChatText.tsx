import React from 'react';
import { type ChatInline, parseChatText } from './chatText';

const renderInline = (nodes: ChatInline[]): React.ReactNode[] =>
  nodes.map((node, index) => {
    switch (node.type) {
      case 'text': return <React.Fragment key={index}>{node.text}</React.Fragment>;
      case 'break': return <br key={index} />;
      case 'link': return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow">{node.text}</a>;
      case 'code': return <code key={index}>{node.text}</code>;
      case 'bold': return <strong key={index}>{renderInline(node.children)}</strong>;
      case 'italic': return <em key={index}>{renderInline(node.children)}</em>;
      case 'strike': return <s key={index}>{renderInline(node.children)}</s>;
    }
  });

/** Chat text with links, light Markdown and code blocks, built as elements and never as HTML. */
export const ChatText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
  <div className={`chat__msg ${className}`}>
    {parseChatText(text).map((block, index) =>
      block.type === 'codeblock'
        ? <pre key={index}><code>{block.text}</code></pre>
        : <p key={index}>{renderInline(block.children)}</p>,
    )}
  </div>
);
