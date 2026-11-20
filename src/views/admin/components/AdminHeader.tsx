import React from 'react';

type AdminHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  // The phone frames draw the heading alone on some tabs.
  descriptionOnPhone?: boolean;
  tight?: boolean;
  children?: React.ReactNode;
};

export const AdminHeader: React.FC<AdminHeaderProps> = ({ title, description, descriptionOnPhone = false, tight = false, children }) => (
  <div className={`dash-head ${tight ? 'dash-head--tight' : ''}`}>
    <div className="min-w-0">
      <h1 className="h-page">{title}</h1>
      {description ? <p className={`dash-head__sub ${descriptionOnPhone ? '' : 'max-sm:hidden'}`}>{description}</p> : null}
    </div>
    {children}
  </div>
);
