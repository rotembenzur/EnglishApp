import { Outlet } from 'react-router-dom';
import { TabBar } from './TabBar';
import { PwaToasts } from './PwaToasts';

/** Phone-width column, content pane scrolls, tab bar pinned to the bottom. */
export function Shell() {
  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <main
        className="scroll-pane mx-auto w-full max-w-md flex-1"
        style={{ paddingTop: 'var(--sat)' }}
      >
        <Outlet />
      </main>
      <TabBar />
      <PwaToasts />
    </div>
  );
}
