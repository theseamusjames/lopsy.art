import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { CanvasMessage } from './CanvasMessage';
import { useCanvasMessageStore } from '../../app/canvas-message-store';
import { useEditorStore } from '../../app/editor-store';
import { tooLargeMessage, type TooLargeSubject } from '../../io/image-too-large';
import type { DocumentSizeLimit } from '../../utils/document-size';

const meta: Meta<typeof CanvasMessage> = {
  component: CanvasMessage,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof CanvasMessage>;

/** Shows the message for `subject`; with no canvas area around it, it centres in the window. */
function Shown({ subject, limit }: { subject: TooLargeSubject; limit: DocumentSizeLimit }) {
  useEffect(() => {
    const text = tooLargeMessage(subject, limit);
    useCanvasMessageStore.getState().show({ ...text, documentVersion: useEditorStore.getState().documentVersion });
  }, [subject, limit]);
  return <CanvasMessage />;
}

const DEVICE: DocumentSizeLimit = { side: 16384, isDevice: true };

export const ImageTooLarge: Story = {
  render: () => <Shown subject={{ kind: 'image', name: 'ultrawide.jpg', width: 17504, height: 3440 }} limit={DEVICE} />,
};

export const PasteTooLarge: Story = {
  render: () => <Shown subject={{ kind: 'paste', name: null, width: 9000, height: 600 }} limit={{ side: 8192, isDevice: true }} />,
};

export const ProjectOverLopsysCap: Story = {
  render: () => <Shown subject={{ kind: 'project', name: 'poster.lopsy', width: 20000, height: 12000 }} limit={{ side: 16384, isDevice: false }} />,
};
