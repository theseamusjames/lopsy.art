/** What the share confirmation says, exactly (spec 5.5: only after the user confirms exactly that). */
export function shareWarning(folderName: string, photoCount: number): string {
  const photos = `${photoCount.toLocaleString('en-US')} ${photoCount === 1 ? 'photo' : 'photos'}`;
  return (
    `Anyone who has the link will be able to see and download the ${photos} in the export folder “${folderName}”, ` +
    'and anything added to that folder later, without signing in. They cannot change or delete anything. ' +
    'You can stop sharing at any time.'
  );
}
