import { redirect } from "react-router";

// Plan moved under Settings (one admin menu of 7 items). Old links and bookmarks still work.
export const loader = ({ request }) => {
  const { search } = new URL(request.url);
  throw redirect(`/app/settings/plan${search}`);
};
