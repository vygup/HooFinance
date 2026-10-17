'use client';
import { useEffect } from 'react';
import { shouldWarnBeforeLeaving } from '@/modules/workspaces/domain/switching';
const dirtyForms = new Set<symbol>();
const warning =
  'Есть несохранённые изменения. Покинуть страницу и потерять введённые данные?';
let permitted = false;
let listeners = 0;
export function confirmUnsavedNavigation() {
  return dirtyForms.size === 0 || window.confirm(warning);
}
export function resetNavigationPermission() {
  permitted = false;
}
export function permitDocumentNavigation() {
  permitted = true;
}
function unload(event: BeforeUnloadEvent) {
  if (!permitted && dirtyForms.size) {
    event.preventDefault();
    event.returnValue = '';
  }
}
function click(event: MouseEvent) {
  const anchor =
    event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.target === '_blank' ||
    anchor.hasAttribute('download') ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const target = new URL(anchor.href);
  if (
    shouldWarnBeforeLeaving(
      dirtyForms.size > 0,
      location.origin + location.pathname + location.search,
      target.origin + target.pathname + target.search,
    )
  ) {
    if (!confirmUnsavedNavigation()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else permitDocumentNavigation();
  }
}
function submit(event: SubmitEvent) {
  if (
    !(event.target instanceof HTMLFormElement) ||
    !event.target.hasAttribute('data-navigation-form')
  )
    return;
  if (!confirmUnsavedNavigation()) {
    event.preventDefault();
    event.stopImmediatePropagation();
  } else permitDocumentNavigation();
}
/** One guard for all mounted forms; RHF reset clears dirtiness after a successful save. */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    const id = Symbol();
    if (dirty) dirtyForms.add(id);
    if (listeners++ === 0) {
      permitted = false;
      window.addEventListener('beforeunload', unload);
      document.addEventListener('click', click, true);
      document.addEventListener('submit', submit, true);
    }
    return () => {
      dirtyForms.delete(id);
      if (--listeners === 0) {
        window.removeEventListener('beforeunload', unload);
        document.removeEventListener('click', click, true);
        document.removeEventListener('submit', submit, true);
      }
    };
  }, [dirty]);
}
