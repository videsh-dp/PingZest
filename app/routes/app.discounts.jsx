import { redirect } from "react-router";

// Discounts moved under Widgets (one admin menu of 7 items). Old links and bookmarks still work.
export const loader = ({ request }) => {
  const { search } = new URL(request.url);
  throw redirect(`/app/widgets/discounts${search}`);
};
