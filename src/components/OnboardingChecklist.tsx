import React, { useId, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { CircleCheck, Circle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { IconButton } from './ui';

export interface ChecklistItem {
  id: string;
  label: string;
  isCompleted: boolean;
  action?: () => void;
}

interface OnboardingChecklistProps {
  items: ChecklistItem[];
  onDismiss: () => void;
  title?: string;
}

export const OnboardingChecklist: React.FC<OnboardingChecklistProps> = ({ items, onDismiss, title }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const bodyId = useId();

  const completedCount = items.filter(i => i.isCompleted).length;
  const allDone = completedCount === items.length;

  return (
    <aside className="stock stock--lift dash-steps">
      <div className="dash-steps__head">
        <button
          type="button"
          onClick={() => setIsCollapsed(prev => !prev)}
          aria-expanded={!isCollapsed}
          aria-controls={bodyId}
          className="dash-steps__toggle"
        >
          <span className="dash-steps__title">{title || t`First steps`}</span>
          <span className="fig dash-steps__count">{completedCount}/{items.length}</span>
          {isCollapsed ? (
            <ChevronUp className="icon" aria-hidden="true" />
          ) : (
            <ChevronDown className="icon" aria-hidden="true" />
          )}
        </button>
        <IconButton label={t`Dismiss checklist`} onClick={onDismiss}>
          <X className="icon" aria-hidden="true" />
        </IconButton>
      </div>

      <div id={bodyId} hidden={isCollapsed} className="dash-steps__body">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.action}
            disabled={item.isCompleted || !item.action}
            className={`menu__item dash-steps__item ${item.isCompleted ? 'is-done' : ''}`}
          >
            {item.isCompleted ? (
              <CircleCheck className="icon" aria-hidden="true" />
            ) : (
              <Circle className="icon" aria-hidden="true" />
            )}
            <span>{item.label}</span>
          </button>
        ))}

        {allDone && (
          <div className="dash-steps__done">
            <p><Trans>All set! 🎉</Trans></p>
            <p><Trans>You're ready to use Tavio.</Trans></p>
          </div>
        )}
      </div>
    </aside>
  );
};
