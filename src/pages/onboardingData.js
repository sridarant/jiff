// src/pages/onboardingData.js
// All static data for the Onboarding flow.
// Extracted from Onboarding.jsx to keep the component under 400L.

const WHO_OPTIONS = [
  { id:'just_me', emoji:'🧑',    label:'Just me',       sub:'Cooking for 1', servings:1 },
  { id:'partner', emoji:'👫',    label:'Me & partner',  sub:'Cooking for 2', servings:2 },
  { id:'family',  emoji:'👨‍👩‍👧', label:'Family',        sub:'3–5 people',    servings:4 },
  { id:'joint',   emoji:'🏠',    label:'Joint family',  sub:'6+ people',     servings:8 },
];

const DIET_OPTIONS = [
  { id:'veg',        emoji:'🥦', label:'Vegetarian',  desc:'No meat or fish'           },
  { id:'non-veg',    emoji:'🍗', label:'Non-veg',     desc:'Includes meat, fish, eggs' },
  { id:'vegan',      emoji:'🌱', label:'Vegan',       desc:'No animal products'        },
  { id:'eggetarian', emoji:'🥚', label:'Eggetarian',  desc:'Veg + eggs'                },
  { id:'jain',       emoji:'🪷', label:'Jain',        desc:'No root vegetables'        },
  { id:'halal',      emoji:'☪️', label:'Halal',       desc:'Halal-certified only'      },
];

const STAPLE_GROUPS = [
  {
    label: 'Fresh produce — most people buy these weekly',
    items: [
      { id:'onion',            label:'Onion'            },
      { id:'tomato',           label:'Tomato'           },
      { id:'garlic',           label:'Garlic'           },
      { id:'ginger',           label:'Ginger'           },
      { id:'green_chilli',     label:'Green chillies'   },
      { id:'coriander_leaves', label:'Coriander leaves' },
      { id:'lemon',            label:'Lemon'            },
      { id:'potato',           label:'Potato'           },
    ],
  },
  {
    label: 'Dairy & eggs',
    items: [
      { id:'curd',   label:'Curd / Yoghurt' },
      { id:'milk',   label:'Milk'           },
      { id:'butter', label:'Butter'         },
      { id:'egg',    label:'Eggs'           },
      { id:'paneer', label:'Paneer'         },
    ],
  },
  {
    label: 'Regional staples — tap what applies to your kitchen',
    items: [
      { id:'coconut',      label:'Coconut'             },
      { id:'coconut_milk', label:'Coconut milk'        },
      { id:'curry_leaves', label:'Curry leaves'        },
      { id:'mustard_oil',  label:'Mustard oil'         },
      { id:'raw_banana',   label:'Raw banana'          },
      { id:'drumstick',    label:'Drumstick / Moringa' },
      { id:'bread',        label:'Bread'               },
      { id:'chicken_wkly', label:'Chicken (weekly)'    },
      { id:'fish_wkly',    label:'Fish (weekly)'       },
    ],
  },
];

// Grouped cuisine picker — IDs match cuisine.js exactly
const CUISINE_PICKER_GROUPS = [
  {
    label: 'South India',
    items: [
      { id:'tamil_nadu',    label:'Tamil Nadu'    },
      { id:'kerala',        label:'Kerala'        },
      { id:'karnataka',     label:'Karnataka'     },
      { id:'andhra',        label:'Andhra'        },
      { id:'hyderabadi',    label:'Hyderabadi'    },
      { id:'chettinad',     label:'Chettinad'     },
    ],
  },
  {
    label: 'North India',
    items: [
      { id:'punjabi',       label:'Punjabi'       },
      { id:'awadhi',        label:'Awadhi'        },
      { id:'rajasthani',    label:'Rajasthani'    },
      { id:'kashmiri',      label:'Kashmiri'      },
    ],
  },
  {
    label: 'East & West',
    items: [
      { id:'bengali',       label:'Bengali'       },
      { id:'gujarati',      label:'Gujarati'      },
      { id:'maharashtrian', label:'Maharashtrian' },
      { id:'goan',          label:'Goan'          },
      { id:'odia',          label:'Odia'          },
    ],
  },
  {
    label: 'Street food',
    items: [
      { id:'chaat',         label:'Chaat'         },
      { id:'mumbai_street', label:'Mumbai street' },
      { id:'delhi_street',  label:'Delhi street'  },
    ],
  },
  {
    label: 'Global',
    items: [
      { id:'chinese',       label:'Chinese'       },
      { id:'continental',   label:'Continental'   },
      { id:'mediterranean', label:'Mediterranean' },
      { id:'middle_eastern',label:'Middle Eastern'},
      { id:'italian',       label:'Italian'       },
    ],
  },
];

const GOAL_OPTIONS = [
  { id:'use_what_i_have', emoji:'🧊', label:'Cook with what I have', desc:'Zero-waste cooking'         },
  { id:'eat_healthier',   emoji:'🥗', label:'Eat healthier',     desc:'Balanced, nutritious meals' },
  { id:'try_new_things',  emoji:'🌍', label:'Try new things',    desc:'Explore new cuisines'       },
  { id:'cook_faster',     emoji:'⚡', label:'Cook faster',       desc:'Quick weekday meals'        },
  { id:'reduce_waste',    emoji:'♻️', label:'Reduce food waste', desc:'Rescue leftovers'           },
];

const TIER1_DEFAULTS = [
  'Oil','Ghee','Salt','Sugar','Turmeric','Red chilli powder',
  'Coriander powder','Cumin powder','Garam masala','Cumin seeds',
  'Mustard seeds','Coriander seeds','Cardamom','Cloves','Cinnamon',
  'Bay leaves','Dried red chillies','Fenugreek seeds','Asafoetida',
  'Tamarind','Amchur','Chaat masala','Rice','Atta','Maida','Sooji',
  'Poha','Toor dal','Moong dal','Chana dal','Masoor dal','Urad dal',
  'Ginger garlic paste','Tomato puree','Cashews','Almonds','Raisins',
];

export {
  WHO_OPTIONS,
  DIET_OPTIONS,
  STAPLE_GROUPS,
  CUISINE_PICKER_GROUPS,
  GOAL_OPTIONS,
  TIER1_DEFAULTS,
};
