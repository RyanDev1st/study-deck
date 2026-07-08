/*
 * SAMPLE reference sheets matching data.sample.js (keyed by exact section title).
 * Copy to theory.js to use. The full set is private and not in this repo.
 */
const theoryData = {
  "Basic Counting — Sum, Product & Subset Rules": `
    <h3>Sum, product &amp; subset rules</h3>
    <ul>
      <li><b>Product rule.</b> If a task is a sequence of independent stages with n1, n2, ... choices, the total is n1 &middot; n2 &middot; ... (multiply). Use it for "AND" / build-it-in-steps.</li>
      <li><b>Sum rule.</b> If the outcomes split into disjoint cases with a1, a2, ... options, the total is a1 + a2 + ... (add). Use it for "OR" / mutually exclusive cases (e.g. different lengths).</li>
      <li><b>Complement (subtraction) rule.</b> (at least one) = (total) &minus; (none). The signal word "at least" usually means count the complement and subtract.</li>
      <li><b>Subsets.</b> A set of n elements has <b>2<sup>n</sup></b> subsets (each element is independently in/out).</li>
      <li>Number of subsets of size k: <b>C(n,k)</b>. "At most 2" = C(n,0)+C(n,1)+C(n,2).</li>
    </ul>
    <p><b>Worked example.</b> Strings of length 5 over 128 symbols containing "@" at least once = 128<sup>5</sup> &minus; 127<sup>5</sup> (all minus those with no @).</p>`,
  "Advanced Counting — Building Generating Functions": `
    <h3>Building ordinary generating functions (OGF)</h3>
    <p>The OGF of (a<sub>0</sub>, a<sub>1</sub>, a<sub>2</sub>, ...) is A(x) = &sum; a<sub>n</sub> x<sup>n</sup>. Core catalogue:</p>
    <ul>
      <li>(1,1,1,...) &harr; 1/(1&minus;x). &nbsp; (1,2,3,...) i.e. a<sub>n</sub>=n+1 &harr; 1/(1&minus;x)<sup>2</sup>.</li>
      <li>(1,c,c<sup>2</sup>,...) &harr; 1/(1&minus;cx). &nbsp; C(n+k&minus;1,k) for fixed n &harr; 1/(1&minus;x)<sup>n</sup>.</li>
      <li><b>Fibonacci</b> (0,1,1,2,3,5,...) &harr; x/(1&minus;x&minus;x<sup>2</sup>).</li>
    </ul>
    <p><b>Modelling rule.</b> Each independent choice contributes a factor listing its allowed counts as exponents; MULTIPLY the factors (exponents add to the total).</p>
    <ul>
      <li>even count: 1+x<sup>2</sup>+x<sup>4</sup>+... = 1/(1&minus;x<sup>2</sup>); multiples of 5: 1/(1&minus;x<sup>5</sup>).</li>
      <li>0..4 of a type (finite): 1+x+x<sup>2</sup>+x<sup>3</sup>+x<sup>4</sup>; 0 or 1: (1+x).</li>
    </ul>
    <p><b>Deriving Fibonacci's GF.</b> From f<sub>n</sub>=f<sub>n&minus;1</sub>+f<sub>n&minus;2</sub>, multiply by x<sup>n</sup>, sum n&ge;2: F&minus;x = xF + x<sup>2</sup>F &rArr; F(1&minus;x&minus;x<sup>2</sup>) = x.</p>`,
  "Graphs — Families & Basic Properties": `
    <h3>Graph families &amp; basic counts</h3>
    <ul>
      <li><b>Handshaking:</b> &sum; deg(v) = 2|E|. Corollary: the number of odd-degree vertices is even.</li>
      <li><b>K<sub>n</sub></b> (complete): |E| = C(n,2) = n(n&minus;1)/2, every degree n&minus;1.</li>
      <li><b>C<sub>n</sub></b> (cycle): n vertices, n edges, every degree 2; bipartite iff n even.</li>
      <li><b>W<sub>n</sub></b> (wheel = C<sub>n</sub> + a hub joined to all): n+1 vertices, 2n edges.</li>
      <li><b>K<sub>m,n</sub></b> (complete bipartite): m+n vertices, m&middot;n edges, always bipartite.</li>
      <li><b>Q<sub>n</sub></b> (hypercube): 2<sup>n</sup> vertices, each degree n, |E| = n&middot;2<sup>n&minus;1</sup>; bipartite.</li>
    </ul>
    <p><b>Example (W<sub>7</sub>):</b> hub + 7-cycle = 8 vertices, 7 rim + 7 spokes = 14 edges.</p>`,
  "Trees — Terminology & Structure": `
    <h3>Tree terminology &amp; structure</h3>
    <ul>
      <li><b>Tree</b> = connected acyclic graph. On n vertices it has exactly <b>n&minus;1 edges</b>.</li>
      <li>Equivalent definitions: connected &amp; n&minus;1 edges; acyclic &amp; n&minus;1 edges; unique simple path between every pair.</li>
      <li>Every tree with n&ge;2 has at least two <b>leaves</b> (degree-1 vertices).</li>
      <li><b>Rooted tree:</b> level of a node = edges to the root (root at level 0); <b>height</b> = maximum level (longest root-to-leaf path).</li>
      <li><b>Internal</b> node = has &ge;1 child; <b>leaf</b> = no children. Ancestors/descendants along the root path.</li>
      <li><b>Forest</b> of k trees on n vertices has n&minus;k edges.</li>
    </ul>`
};
