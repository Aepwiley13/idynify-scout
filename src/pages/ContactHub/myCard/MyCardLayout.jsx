/**
 * MyCardLayout — a finished digital card first, with editing as a separate mode.
 *
 * The saved card is the first view at every size. Edit Card opens the existing
 * editor; desktop keeps the preview beside it while editing and mobile focuses
 * on the form. Cancel and successful Save return to the finished card.
 *
 * It holds no card and no draft: the editor, the preview and any actions
 * (the Save bar) are passed in. With no preview there is nothing to switch
 * between: the one thing passed as `editor` fills the page (a loading message,
 * an error, a notice that the page is read-only). This element is the scroll container, the
 * same pattern as the rest of Contact Hub: the shell does not scroll module
 * content, each module does.
 */
import { useEffect, useRef } from 'react';
import './MyCard.css';

/**
 * @param {object} props
 * @param {React.ReactNode} props.editor
 * @param {React.ReactNode} [props.preview]  none: the page is a single column (see above)
 * @param {React.ReactNode} [props.actions]  a bar kept in view at the bottom (Save)
 * @param {React.ReactNode} [props.notice]   messages above both (a failed save, a conflict)
 * @param {React.ReactNode} [props.back]     a link above the heading, back to where the person came from
 * @param {boolean} [props.editing]
 */
export default function MyCardLayout({
  editor, preview = null, actions = null, notice = null, back = null,
  editing = false, onEdit,
}) {
  const view = editing ? 'edit' : 'preview';
  const editButton = useRef(null);
  const editorPane = useRef(null);
  const previousEditing = useRef(editing);
  useEffect(() => {
    if (previousEditing.current !== editing) {
      (editing ? editorPane.current?.querySelector('input, button') : editButton.current)?.focus?.();
      previousEditing.current = editing;
    }
  }, [editing]);

  return (
    <div className="mycard" data-view={view} data-editing={editing ? 'true' : 'false'}>
      <div className="mycard-inner">
        <div className="mycard-body">
          {back}
          <header className="mycard-header">
            <h1 className="mycard-title">My Card</h1>
            <p className="mycard-tagline">Your digital business card</p>
            {preview && !editing && <button ref={editButton} type="button" className="mycard-btn mycard-btn--secondary mycard-edit-card" onClick={onEdit}>Edit Card</button>}
          </header>

          {notice}

          {preview ? (
            <>
              <div className="mycard-grid">
                {editing && <div ref={editorPane} className="mycard-pane mycard-pane--editor">{editor}</div>}
                <div className="mycard-pane mycard-pane--preview">{preview}</div>
              </div>
            </>
          ) : (
            <div className="mycard-single">{editor}</div>
          )}
        </div>
        {editing && actions ? <div className="mycard-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
