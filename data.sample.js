/*
 * SAMPLE question bank — a small public example of the data format.
 * The full Discrete Mathematics bank (113 questions) is kept private and is NOT in this repo.
 * To run the app: copy this file to data.js (and theory.sample.js to theory.js), or drop in your own bank.
 * Shape: each top-level entry is a SUBJECT; its quizzes[] are sections; section title also keys theory.
 */
const quizData = [
  {
    "title": "Basic Counting",
    "complete": "Basic counting section complete — nice work!",
    "error": "Not quite — read the worked solution.",
    "quizzes": [
      {
        "id": 1,
        "title": "Basic Counting — Sum, Product & Subset Rules",
        "quiz": [
          {
            "questionText": "How many subsets does a set with n elements have?",
            "answerOptions": [
              {
                "answerText": "2^n",
                "isCorrect": "true",
                "explanation": "Build a subset by deciding, independently for each of the n elements, whether it is IN or OUT. That is 2 choices per element and the choices are independent, so by the product rule the number of subsets is 2*2*...*2 (n factors) = 2^n. Check n=3: elements {a,b,c} give 2^3 = 8 subsets, and indeed {}, {a},{b},{c},{a,b},{a,c},{b,c},{a,b,c} is 8."
              },
              {
                "answerText": "n^2",
                "isCorrect": "false",
                "explanation": "n^2 counts ordered pairs of elements, not subsets. For n=3 it gives 9, but there are 8 subsets."
              },
              {
                "answerText": "2n",
                "isCorrect": "false",
                "explanation": "2n grows only linearly. For n=3 it gives 6, but there are 8 subsets. The count is exponential because each element is an independent in/out choice."
              },
              {
                "answerText": "n!",
                "isCorrect": "false",
                "explanation": "n! counts orderings (permutations) of the n elements, not subsets. For n=3 it gives 6, not 8."
              }
            ]
          },
          {
            "questionText": "How many 2-element subsets does a set with n elements have?",
            "answerOptions": [
              {
                "answerText": "C(n,2) = n(n-1)/2",
                "isCorrect": "true",
                "explanation": "A 2-element subset is an UNORDERED choice of 2 of the n elements, which is by definition C(n,2). Compute it from the formula C(n,k) = n!/(k!(n-k)!): C(n,2) = n!/(2!(n-2)!) = [n(n-1)(n-2)!]/[2*(n-2)!] = n(n-1)/2. The (n-2)! cancels. Intuition for the /2: there are n(n-1) ORDERED pairs (first pick n ways, second pick n-1 ways), but each 2-subset {a,b} is counted twice (as (a,b) and (b,a)), so divide by 2."
              },
              {
                "answerText": "n(n-1)",
                "isCorrect": "false",
                "explanation": "n(n-1) counts ORDERED pairs of distinct elements. A subset is unordered, so {a,b} and {b,a} are the same; you must divide by 2."
              },
              {
                "answerText": "n^2",
                "isCorrect": "false",
                "explanation": "n^2 counts ordered pairs allowing repetition (including (a,a)). A 2-element subset needs two DIFFERENT elements and is unordered."
              },
              {
                "answerText": "2n",
                "isCorrect": "false",
                "explanation": "2n is far too small; it is linear while the number of pairs grows quadratically. For n=4, C(4,2)=6, not 8."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "title": "Advanced Counting",
    "complete": "Advanced counting complete — you can build and solve generating functions!",
    "error": "Not quite — walk through the derivation again.",
    "quizzes": [
      {
        "id": 10,
        "title": "Advanced Counting — Building Generating Functions",
        "quiz": [
          {
            "questionText": "What is the (ordinary) generating function of the constant sequence (1, 1, 1, 1, ...)?",
            "answerOptions": [
              {
                "answerText": "1/(1 - x)",
                "isCorrect": "true",
                "explanation": "The ordinary generating function (OGF) of a sequence (a0,a1,a2,...) is the formal power series A(x) = a0 + a1 x + a2 x^2 + ... For the all-ones sequence this is 1 + x + x^2 + x^3 + ... which is the geometric series. Sum it: let S = 1 + x + x^2 + ...; then xS = x + x^2 + ...; subtract: S - xS = 1, so S(1-x) = 1 and S = 1/(1-x). This is THE fundamental generating function — memorize it, since almost everything is built from it."
              },
              {
                "answerText": "1/(1 + x)",
                "isCorrect": "false",
                "explanation": "1/(1+x) = 1 - x + x^2 - x^3 + ... is the generating function of the ALTERNATING sequence (1,-1,1,-1,...). The all-ones sequence gives 1/(1-x)."
              },
              {
                "answerText": "x/(1 - x)",
                "isCorrect": "false",
                "explanation": "x/(1-x) = x + x^2 + x^3 + ... has constant term 0, so it generates (0,1,1,1,...). The all-ones sequence (starting a0=1) is 1/(1-x)."
              },
              {
                "answerText": "1 - x",
                "isCorrect": "false",
                "explanation": "1 - x is a polynomial generating the finite sequence (1,-1,0,0,...). It is the RECIPROCAL of the answer: 1/(1-x) generates all ones."
              }
            ]
          },
          {
            "questionText": "What is the generating function of the sequence (1, 2, 3, 4, ...) (that is a_n = n+1)?",
            "answerOptions": [
              {
                "answerText": "1/(1 - x)^2",
                "isCorrect": "true",
                "explanation": "Start from the known series 1/(1-x) = 1 + x + x^2 + x^3 + ... Differentiate both sides with respect to x. Left side: d/dx [ (1-x)^(-1) ] = (1-x)^(-2) = 1/(1-x)^2. Right side, term by term: d/dx [1 + x + x^2 + x^3 + ...] = 1 + 2x + 3x^2 + 4x^3 + ... So 1/(1-x)^2 = 1 + 2x + 3x^2 + ... = sum_{n>=0} (n+1) x^n, whose coefficients are exactly (1,2,3,4,...). General fact: 1/(1-x)^2 has coefficient (n+1) on x^n."
              },
              {
                "answerText": "1/(1 - x)",
                "isCorrect": "false",
                "explanation": "1/(1-x) generates the constant sequence (1,1,1,...). To get the increasing (1,2,3,...) you differentiate it, producing 1/(1-x)^2."
              },
              {
                "answerText": "x/(1 - x)^2",
                "isCorrect": "false",
                "explanation": "x/(1-x)^2 = 0 + x + 2x^2 + 3x^3 + ... generates (0,1,2,3,...) with a_n = n. The sequence (1,2,3,...) with a_n = n+1 is 1/(1-x)^2."
              },
              {
                "answerText": "1/(1 - x^2)",
                "isCorrect": "false",
                "explanation": "1/(1-x^2) = 1 + x^2 + x^4 + ... generates (1,0,1,0,...). Differentiating 1/(1-x) is what produces (1,2,3,...)."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "title": "Graphs",
    "complete": "Graphs complete — families, Euler/Hamilton, planarity and colouring!",
    "error": "Not quite — check the definition or the counting argument.",
    "quizzes": [
      {
        "id": 16,
        "title": "Graphs — Families & Basic Properties",
        "quiz": [
          {
            "questionText": "The Handshaking Theorem states that in any undirected graph, the sum of all vertex degrees equals:",
            "answerOptions": [
              {
                "answerText": "2 * |E| (twice the number of edges)",
                "isCorrect": "true",
                "explanation": "Every edge has two endpoints, so it contributes exactly 1 to the degree of each of its two endpoints, i.e. 2 to the total degree sum. Summing over all edges, the total of all vertex degrees is 2*|E|. A key corollary: the number of vertices of ODD degree must be even (because the total is even). Example: a triangle has 3 vertices of degree 2, sum = 6 = 2*3 edges."
              },
              {
                "answerText": "|E| (the number of edges)",
                "isCorrect": "false",
                "explanation": "Each edge is counted at BOTH of its endpoints, so it adds 2 to the degree sum, not 1. The total is 2|E|."
              },
              {
                "answerText": "|V| (the number of vertices)",
                "isCorrect": "false",
                "explanation": "The degree sum depends on edges, not the vertex count. It equals 2|E|."
              },
              {
                "answerText": "|V| * |E|",
                "isCorrect": "false",
                "explanation": "There is no such product relation. The degree sum is exactly twice the edge count: 2|E|."
              }
            ]
          },
          {
            "questionText": "How many edges does the complete graph K_n have?",
            "answerOptions": [
              {
                "answerText": "C(n,2) = n(n-1)/2",
                "isCorrect": "true",
                "explanation": "In K_n every pair of distinct vertices is joined by exactly one edge, so the number of edges equals the number of unordered vertex pairs: C(n,2) = n(n-1)/2. Check via handshaking: each vertex has degree n-1, so the degree sum is n(n-1) = 2|E|, giving |E| = n(n-1)/2. For n=10: C(10,2) = 45."
              },
              {
                "answerText": "n(n-1)",
                "isCorrect": "false",
                "explanation": "n(n-1) counts ORDERED pairs (each edge twice). Divide by 2 for unordered pairs: n(n-1)/2 = C(n,2)."
              },
              {
                "answerText": "n^2",
                "isCorrect": "false",
                "explanation": "n^2 would count ordered pairs including self-loops (v,v). Simple graph K_n has no loops and unordered edges: C(n,2)."
              },
              {
                "answerText": "2^n",
                "isCorrect": "false",
                "explanation": "2^n counts subsets of vertices, not edges. The edge count of K_n is C(n,2)."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "title": "Trees",
    "complete": "Trees complete — terminology, m-ary counting, Prufer/Cayley and spanning trees!",
    "error": "Not quite — revisit the tree identity.",
    "quizzes": [
      {
        "id": 21,
        "title": "Trees — Terminology & Structure",
        "quiz": [
          {
            "questionText": "How many edges does a tree with n vertices have?",
            "answerOptions": [
              {
                "answerText": "n - 1",
                "isCorrect": "true",
                "explanation": "A tree is a connected acyclic graph. Proof that it has n-1 edges: start from any single vertex (0 edges) and build the tree by adding vertices one at a time; each new vertex must attach by exactly ONE edge to the existing part (more than one would create a cycle, fewer would disconnect it). Adding n-1 vertices adds n-1 edges. So a tree on n vertices has exactly n-1 edges. (Conversely, a connected graph with n-1 edges, or an acyclic graph with n-1 edges, is a tree.)"
              },
              {
                "answerText": "n",
                "isCorrect": "false",
                "explanation": "A connected graph with n vertices and n edges contains exactly one cycle, so it is NOT a tree. A tree has one fewer edge: n-1."
              },
              {
                "answerText": "n + 1",
                "isCorrect": "false",
                "explanation": "That is even more edges and forces multiple cycles. Trees are minimally connected with n-1 edges."
              },
              {
                "answerText": "2n - 2",
                "isCorrect": "false",
                "explanation": "2n-2 = 2(n-1) is the DEGREE sum of a tree (by handshaking, since it has n-1 edges), not the edge count. The number of edges is n-1."
              }
            ]
          },
          {
            "questionText": "In a rooted tree, how are the height of the tree and the level of a node defined?",
            "answerOptions": [
              {
                "answerText": "The level of a node is its distance (number of edges) from the root; the height is the maximum level, i.e. the length of the longest root-to-leaf path.",
                "isCorrect": "true",
                "explanation": "The root sits at level 0. A node's LEVEL is the number of edges on the unique path from the root down to that node (so children of the root are level 1, their children level 2, and so on). The HEIGHT of the tree is the greatest level attained — equivalently the length (edge count) of the longest path from the root to any leaf. Example: if the deepest leaf is 4 edges below the root, the tree has height 4."
              },
              {
                "answerText": "The level is the number of children; the height is the number of leaves.",
                "isCorrect": "false",
                "explanation": "Level is a DEPTH measured from the root (edges to the root), not a child count; height is the maximum depth, not a leaf count."
              },
              {
                "answerText": "The height is the number of vertices; the level is the degree.",
                "isCorrect": "false",
                "explanation": "Height is a longest-path LENGTH (edges), not a vertex count, and level is depth from the root, not degree."
              },
              {
                "answerText": "The level is the number of edges; the height is the number of edges too, and they are always equal.",
                "isCorrect": "false",
                "explanation": "Level is per-NODE (its depth); height is a single number for the whole tree (the maximum level). They coincide only for the deepest leaves."
              }
            ]
          }
        ]
      }
    ]
  }
];
