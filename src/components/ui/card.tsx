// shadcn/ui Card's look on the site's surface: a ruled box, square-ish corners, no shadow. Only the classes:
// the site's cards are a <section> (the apply box), a <details> that folds (calls, contents) and a <figure>
// (the example fact), so each element keeps its own semantics and takes the card look.
const cardClasses = 'rounded-md border border-border bg-card text-card-foreground'

export { cardClasses }
