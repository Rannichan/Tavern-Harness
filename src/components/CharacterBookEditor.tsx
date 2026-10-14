import { memo, useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { json } from '@codemirror/lang-json';

const CharacterBookEditor = memo(function CharacterBookEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  lineWrapping = true,
  className,
}: {
  value: string;
  onChange?: (value: string) => void;
  placeholder: string;
  readOnly?: boolean;
  lineWrapping?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const wrappingRef = useRef(new Compartment());
  const readOnlyRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          json(),
          wrappingRef.current.of(lineWrapping ? EditorView.lineWrapping : []),
          readOnlyRef.current.of(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => view.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: wrappingRef.current.reconfigure(lineWrapping ? EditorView.lineWrapping : []) });
  }, [lineWrapping]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({
      effects: readOnlyRef.current.reconfigure(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className={`character-book-editor ${className ?? ''}`.trim()} aria-label={placeholder} />;
});

export default CharacterBookEditor;
