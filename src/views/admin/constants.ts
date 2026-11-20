import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { TourStep } from '../../components/OnboardingTour';

type TourStepDescriptor = Omit<TourStep, 'title' | 'content'> & {
  title: MessageDescriptor;
  content: MessageDescriptor;
};

export const TOUR_STEPS: TourStepDescriptor[] = [
  {
    targetId: 'admin-sidebar',
    title: msg`Welcome to your Dashboard`,
    content: msg`This is your mission control. From here you can manage all aspects of your video infrastructure.`,
    position: 'bottom'
  },
  {
    targetId: 'admin-nav-rooms',
    title: msg`Manage Rooms`,
    content: msg`View active sessions, create new permanent rooms, and manage access controls.`,
    position: 'bottom'
  },
  {
    targetId: 'admin-new-room-btn',
    title: msg`Create a Room`,
    content: msg`Click here to set up your first permanent meeting room with custom branding and permissions.`,
    position: 'bottom'
  },
];
