/**
 * MyCardLayout — the editor and its preview, arranged for the screen.
 *
 * From 900px the two sit side by side, the preview staying in view while the
 * form scrolls. Under that there is one column and a two-way switch, Edit or
 * Preview; the screen size is decided by the stylesheet, so both panels are
 * always in the page and only the one in view is shown.
 *
 * It holds no card and no draft: the editor, the preview and any actions
 * (a Save bar, later) are passed in. This element is the scroll container, the
 * same pattern as the rest of Contact Hub: the shell does not scroll module
 * content, each module does.
 */
import { useState } from 'react';
import './MyCard.css';

/**
 * @param {object} props
 * @param {React.ReactNode} props.editor
 * @param {React.ReactNode} props.preview
 * @param {React.ReactNode} [props.actions]  a bar kept in view at the bottom (Save, later)
 * @param {React.ReactNode} [props.notice]   a message above both (a failed load, a conflict)
 * @param {'edit'|'preview'} [props.initialView]  which panel a narrow screen starts on
 */
export default function MyCardLayout({ editor, preview, actions = null, notice = null, initialView = 'edit' }) {
  const [view, setView] = useState(initialView === 'preview' ? 'preview' : 'edit');

  return (
    <div className="mycard" data-view={view}>
      <div className="mycard-inner">
        <div className="mycard-body">
          <header className="mycard-header">
            <h1 className="mycard-title">My Card</h1>
            <p className="mycard-tagline">Choose what people see when you share your card.</p>
          </header>

          {notice}

          <div className="mycard-switch" role="group" aria-label="Show">
            <button type="button" className="mycard-switch-btn" aria-pressed={view === 'edit'} onClick={() => setView('edit')}>
              Edit
            </button>
            <button type="button" className="mycard-switch-btn" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>
              Preview
            </button>
          </div>

          <div className="mycard-grid">
            <div className="mycard-pane mycard-pane--editor">{editor}</div>
            <div className="mycard-pane mycard-pane--preview">{preview}</div>
          </div>
        </div>
        {actions ? <div className="mycard-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
