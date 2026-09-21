/*
 * Cedar Hollow property catalogue + client-side search.
 *
 * This is the single source of truth for the properties shown on the site.
 * It powers the search box on the homepage and the results rendered on
 * search-results.html. No backend required; filtering happens in the browser.
 *
 * To add or edit a property, change the LISTINGS array below. Every field is
 * plain data; `nameHtml` carries the italic styling used in headings, while
 * `name` is the plain-text version used for matching.
 */
(function () {
  "use strict";

  var LISTINGS = [
    {
      id: "cedar-hollow-treehouse",
      name: "Cedar Hollow Treehouse",
      nameHtml: '<span class="text-weight-normal text-style-italic">Cedar Hollow</span> Treehouse',
      destination: "Oxford",
      type: "Treehouse",
      region: "Oxfordshire",
      sleeps: 6,
      bedrooms: 1,
      bathrooms: 1,
      price: 350,
      featured: 1,
      highlight: "Underfloor heating",
      minimumStay: "",
      photos: [
        { src: "images/gallery/cedar-hollow-treehouse-s01-1060.webp", srcset: "images/gallery/cedar-hollow-treehouse-s01-530.webp 530w, images/gallery/cedar-hollow-treehouse-s01-1060.webp 1060w" },
        { src: "images/gallery/cedar-hollow-treehouse-s02-1060.webp", srcset: "images/gallery/cedar-hollow-treehouse-s02-530.webp 530w, images/gallery/cedar-hollow-treehouse-s02-1060.webp 1060w" },
        { src: "images/gallery/cedar-hollow-treehouse-s03-1060.webp", srcset: "images/gallery/cedar-hollow-treehouse-s03-530.webp 530w, images/gallery/cedar-hollow-treehouse-s03-1060.webp 1060w" },
        { src: "images/gallery/cedar-hollow-treehouse-s04-1060.webp", srcset: "images/gallery/cedar-hollow-treehouse-s04-530.webp 530w, images/gallery/cedar-hollow-treehouse-s04-1060.webp 1060w" },
        { src: "images/gallery/cedar-hollow-treehouse-s05-1060.webp", srcset: "images/gallery/cedar-hollow-treehouse-s05-530.webp 530w, images/gallery/cedar-hollow-treehouse-s05-1060.webp 1060w" }
      ],
      image: {
        src: "images/property-cedar-hollow-treehouse-1060.webp",
        sizes: "(max-width: 420px) 100vw, 420px",
        srcset: "images/property-cedar-hollow-treehouse-530.webp 530w, images/property-cedar-hollow-treehouse-1060.webp 1060w"
      },
      description:
        "A 750 sq ft luxury treehouse set among the oaks, with underfloor heating, a full kitchen and a gas BBQ on the balcony.",
      longDescription:
        "Sleeps two adults and up to four children across an open-plan layout with en-suite facilities. Underfloor heating, a fully equipped kitchen and a top-of-the-line gas BBQ on the balcony.",
      bookingUrl: "https://app.checked.in/widget/calendar2/theoaks",
      tourUrl: "https://magichourweb5.s3.eu-west-2.amazonaws.com/TheOaks/index.htm?ss=CedarHollowTreehouse_Entrance"
    },
    {
      id: "fauns-hideaway",
      name: "Faun's Hideaway",
      nameHtml: '<span class="text-weight-normal text-style-italic">Faun’s </span>Hideaway',
      destination: "Oxford",
      type: "Cave",
      region: "Oxfordshire",
      sleeps: 2,
      bedrooms: 1,
      bathrooms: 1,
      price: 175,
      featured: 3,
      highlight: "Narnia-inspired cave",
      minimumStay: "",
      photos: [
        { src: "images/gallery/fauns-hideaway-s01-1060.webp", srcset: "images/gallery/fauns-hideaway-s01-530.webp 530w, images/gallery/fauns-hideaway-s01-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s02-1060.webp", srcset: "images/gallery/fauns-hideaway-s02-530.webp 530w, images/gallery/fauns-hideaway-s02-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s03-1023.webp", srcset: "images/gallery/fauns-hideaway-s03-530.webp 530w, images/gallery/fauns-hideaway-s03-1023.webp 1023w" },
        { src: "images/gallery/fauns-hideaway-s04-1060.webp", srcset: "images/gallery/fauns-hideaway-s04-530.webp 530w, images/gallery/fauns-hideaway-s04-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s05-1060.webp", srcset: "images/gallery/fauns-hideaway-s05-530.webp 530w, images/gallery/fauns-hideaway-s05-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s06-1024.webp", srcset: "images/gallery/fauns-hideaway-s06-530.webp 530w, images/gallery/fauns-hideaway-s06-1024.webp 1024w" },
        { src: "images/gallery/fauns-hideaway-s07-1060.webp", srcset: "images/gallery/fauns-hideaway-s07-530.webp 530w, images/gallery/fauns-hideaway-s07-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s08-1060.webp", srcset: "images/gallery/fauns-hideaway-s08-530.webp 530w, images/gallery/fauns-hideaway-s08-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s09-1060.webp", srcset: "images/gallery/fauns-hideaway-s09-530.webp 530w, images/gallery/fauns-hideaway-s09-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s10-1060.webp", srcset: "images/gallery/fauns-hideaway-s10-530.webp 530w, images/gallery/fauns-hideaway-s10-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s11-1060.webp", srcset: "images/gallery/fauns-hideaway-s11-530.webp 530w, images/gallery/fauns-hideaway-s11-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s12-1060.webp", srcset: "images/gallery/fauns-hideaway-s12-530.webp 530w, images/gallery/fauns-hideaway-s12-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s13-1060.webp", srcset: "images/gallery/fauns-hideaway-s13-530.webp 530w, images/gallery/fauns-hideaway-s13-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s14-1060.webp", srcset: "images/gallery/fauns-hideaway-s14-530.webp 530w, images/gallery/fauns-hideaway-s14-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s15-1060.webp", srcset: "images/gallery/fauns-hideaway-s15-530.webp 530w, images/gallery/fauns-hideaway-s15-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s16-1060.webp", srcset: "images/gallery/fauns-hideaway-s16-530.webp 530w, images/gallery/fauns-hideaway-s16-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s17-1060.webp", srcset: "images/gallery/fauns-hideaway-s17-530.webp 530w, images/gallery/fauns-hideaway-s17-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s18-1024.webp", srcset: "images/gallery/fauns-hideaway-s18-530.webp 530w, images/gallery/fauns-hideaway-s18-1024.webp 1024w" },
        { src: "images/gallery/fauns-hideaway-s19-1060.webp", srcset: "images/gallery/fauns-hideaway-s19-530.webp 530w, images/gallery/fauns-hideaway-s19-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s20-1060.webp", srcset: "images/gallery/fauns-hideaway-s20-530.webp 530w, images/gallery/fauns-hideaway-s20-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s21-1060.webp", srcset: "images/gallery/fauns-hideaway-s21-530.webp 530w, images/gallery/fauns-hideaway-s21-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s22-1060.webp", srcset: "images/gallery/fauns-hideaway-s22-530.webp 530w, images/gallery/fauns-hideaway-s22-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s23-1060.webp", srcset: "images/gallery/fauns-hideaway-s23-530.webp 530w, images/gallery/fauns-hideaway-s23-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s24-1060.webp", srcset: "images/gallery/fauns-hideaway-s24-530.webp 530w, images/gallery/fauns-hideaway-s24-1060.webp 1060w" },
        { src: "images/gallery/fauns-hideaway-s25-1060.webp", srcset: "images/gallery/fauns-hideaway-s25-530.webp 530w, images/gallery/fauns-hideaway-s25-1060.webp 1060w" }
      ],
      image: {
        src: "images/property-fauns-hideaway-1060.webp",
        sizes: "(max-width: 420px) 100vw, 420px",
        srcset: "images/property-fauns-hideaway-530.webp 530w, images/property-fauns-hideaway-1060.webp 1060w"
      },
      description:
        "A Narnia-inspired cave hideaway lit by warm lantern light, with underfloor heating, air conditioning and a full kitchen.",
      longDescription:
        "One bedroom with en-suite, underfloor heating and air conditioning throughout, and a full kitchen: an enchanting realm tucked into the woodland.",
      bookingUrl: "https://app.checked.in/widget/calendar2/fauns-hideaway",
      tourUrl: "https://magichourweb5.s3.eu-west-2.amazonaws.com/TheOaks/index.htm?ss=FaunsHideaway_LivingArea"
    },
    {
      id: "beavers-den",
      name: "Beaver's Den",
      nameHtml: '<span class="text-weight-normal text-style-italic">Beaver’s </span>Den',
      destination: "Oxford",
      type: "Glamping",
      region: "Oxfordshire",
      sleeps: 2,
      bedrooms: 1,
      bathrooms: 0,
      price: 110,
      featured: 5,
      highlight: "Wood-fired hot tub",
      minimumStay: "",
      photos: [
        { src: "images/gallery/beavers-den-s01-1060.webp", srcset: "images/gallery/beavers-den-s01-530.webp 530w, images/gallery/beavers-den-s01-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s02-1060.webp", srcset: "images/gallery/beavers-den-s02-530.webp 530w, images/gallery/beavers-den-s02-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s03-1019.webp", srcset: "images/gallery/beavers-den-s03-530.webp 530w, images/gallery/beavers-den-s03-1019.webp 1019w" },
        { src: "images/gallery/beavers-den-s04-1060.webp", srcset: "images/gallery/beavers-den-s04-530.webp 530w, images/gallery/beavers-den-s04-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s05-1060.webp", srcset: "images/gallery/beavers-den-s05-530.webp 530w, images/gallery/beavers-den-s05-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s06-1060.webp", srcset: "images/gallery/beavers-den-s06-530.webp 530w, images/gallery/beavers-den-s06-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s07-1060.webp", srcset: "images/gallery/beavers-den-s07-530.webp 530w, images/gallery/beavers-den-s07-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s08-1060.webp", srcset: "images/gallery/beavers-den-s08-530.webp 530w, images/gallery/beavers-den-s08-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s09-1060.webp", srcset: "images/gallery/beavers-den-s09-530.webp 530w, images/gallery/beavers-den-s09-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s10-1060.webp", srcset: "images/gallery/beavers-den-s10-530.webp 530w, images/gallery/beavers-den-s10-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s11-1060.webp", srcset: "images/gallery/beavers-den-s11-530.webp 530w, images/gallery/beavers-den-s11-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s12-1060.webp", srcset: "images/gallery/beavers-den-s12-530.webp 530w, images/gallery/beavers-den-s12-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s13-1060.webp", srcset: "images/gallery/beavers-den-s13-530.webp 530w, images/gallery/beavers-den-s13-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s14-1060.webp", srcset: "images/gallery/beavers-den-s14-530.webp 530w, images/gallery/beavers-den-s14-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s15-1060.webp", srcset: "images/gallery/beavers-den-s15-530.webp 530w, images/gallery/beavers-den-s15-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s16-1060.webp", srcset: "images/gallery/beavers-den-s16-530.webp 530w, images/gallery/beavers-den-s16-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s17-1060.webp", srcset: "images/gallery/beavers-den-s17-530.webp 530w, images/gallery/beavers-den-s17-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s18-1060.webp", srcset: "images/gallery/beavers-den-s18-530.webp 530w, images/gallery/beavers-den-s18-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s19-1019.webp", srcset: "images/gallery/beavers-den-s19-530.webp 530w, images/gallery/beavers-den-s19-1019.webp 1019w" },
        { src: "images/gallery/beavers-den-s20-1060.webp", srcset: "images/gallery/beavers-den-s20-530.webp 530w, images/gallery/beavers-den-s20-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s21-1024.webp", srcset: "images/gallery/beavers-den-s21-530.webp 530w, images/gallery/beavers-den-s21-1024.webp 1024w" },
        { src: "images/gallery/beavers-den-s22-1024.webp", srcset: "images/gallery/beavers-den-s22-530.webp 530w, images/gallery/beavers-den-s22-1024.webp 1024w" },
        { src: "images/gallery/beavers-den-s23-1060.webp", srcset: "images/gallery/beavers-den-s23-530.webp 530w, images/gallery/beavers-den-s23-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s24-1060.webp", srcset: "images/gallery/beavers-den-s24-530.webp 530w, images/gallery/beavers-den-s24-1060.webp 1060w" },
        { src: "images/gallery/beavers-den-s25-1060.webp", srcset: "images/gallery/beavers-den-s25-530.webp 530w, images/gallery/beavers-den-s25-1060.webp 1060w" }
      ],
      image: {
        src: "images/property-beavers-den.jpg",
        sizes: "(max-width: 420px) 100vw, 420px",
        srcset: "images/property-beavers-den.jpg 840w"
      },
      description:
        "An uninsulated woodland glamping pod with a private BBQ, firepit, wood-fired hot tub and an escape room challenge.",
      longDescription:
        "A simpler, wilder stay. Uninsulated pod with shared bathroom facilities in the nearby pool room, plus a private BBQ, firepit and wood-fired hot tub.",
      bookingUrl: "https://app.checked.in/widget/calendar2/beavers-den-1",
      tourUrl: "https://magichourweb5.s3.eu-west-2.amazonaws.com/TheOaks/index.htm?ss=BeaversDen_Entrance"
    },
    {
      id: "woodsmans-treehouse",
      name: "The Woodsman's Treehouse",
      nameHtml: 'The <span class="text-weight-normal text-style-italic">Woodsman’s </span>Treehouse',
      destination: "Dorset",
      type: "Treehouse",
      region: "Dorset",
      sleeps: 2,
      bedrooms: 1,
      bathrooms: 1,
      price: 495,
      featured: 2,
      highlight: "Rooftop sauna",
      minimumStay: "2 nights midweek, 3 at weekends",
      photos: [
        { src: "images/gallery/woodsmans-treehouse-s01-1000.webp", srcset: "images/gallery/woodsmans-treehouse-s01-530.webp 530w, images/gallery/woodsmans-treehouse-s01-1000.webp 1000w" },
        { src: "images/gallery/woodsmans-treehouse-s02-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s02-530.webp 530w, images/gallery/woodsmans-treehouse-s02-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s03-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s03-530.webp 530w, images/gallery/woodsmans-treehouse-s03-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s04-935.webp", srcset: "images/gallery/woodsmans-treehouse-s04-530.webp 530w, images/gallery/woodsmans-treehouse-s04-935.webp 935w" },
        { src: "images/gallery/woodsmans-treehouse-s05-868.webp", srcset: "images/gallery/woodsmans-treehouse-s05-530.webp 530w, images/gallery/woodsmans-treehouse-s05-868.webp 868w" },
        { src: "images/gallery/woodsmans-treehouse-s06-710.webp", srcset: "images/gallery/woodsmans-treehouse-s06-530.webp 530w, images/gallery/woodsmans-treehouse-s06-710.webp 710w" },
        { src: "images/gallery/woodsmans-treehouse-s07-999.webp", srcset: "images/gallery/woodsmans-treehouse-s07-530.webp 530w, images/gallery/woodsmans-treehouse-s07-999.webp 999w" },
        { src: "images/gallery/woodsmans-treehouse-s08-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s08-530.webp 530w, images/gallery/woodsmans-treehouse-s08-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s09-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s09-530.webp 530w, images/gallery/woodsmans-treehouse-s09-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s10-714.webp", srcset: "images/gallery/woodsmans-treehouse-s10-530.webp 530w, images/gallery/woodsmans-treehouse-s10-714.webp 714w" },
        { src: "images/gallery/woodsmans-treehouse-s11-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s11-530.webp 530w, images/gallery/woodsmans-treehouse-s11-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s12-1000.webp", srcset: "images/gallery/woodsmans-treehouse-s12-530.webp 530w, images/gallery/woodsmans-treehouse-s12-1000.webp 1000w" },
        { src: "images/gallery/woodsmans-treehouse-s13-696.webp", srcset: "images/gallery/woodsmans-treehouse-s13-530.webp 530w, images/gallery/woodsmans-treehouse-s13-696.webp 696w" },
        { src: "images/gallery/woodsmans-treehouse-s14-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s14-530.webp 530w, images/gallery/woodsmans-treehouse-s14-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s15-1000.webp", srcset: "images/gallery/woodsmans-treehouse-s15-530.webp 530w, images/gallery/woodsmans-treehouse-s15-1000.webp 1000w" },
        { src: "images/gallery/woodsmans-treehouse-s16-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s16-530.webp 530w, images/gallery/woodsmans-treehouse-s16-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s17-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s17-530.webp 530w, images/gallery/woodsmans-treehouse-s17-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s18-893.webp", srcset: "images/gallery/woodsmans-treehouse-s18-530.webp 530w, images/gallery/woodsmans-treehouse-s18-893.webp 893w" },
        { src: "images/gallery/woodsmans-treehouse-s19-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s19-530.webp 530w, images/gallery/woodsmans-treehouse-s19-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s20-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s20-530.webp 530w, images/gallery/woodsmans-treehouse-s20-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s21-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s21-530.webp 530w, images/gallery/woodsmans-treehouse-s21-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s22-1060.webp", srcset: "images/gallery/woodsmans-treehouse-s22-530.webp 530w, images/gallery/woodsmans-treehouse-s22-1060.webp 1060w" },
        { src: "images/gallery/woodsmans-treehouse-s23-714.webp", srcset: "images/gallery/woodsmans-treehouse-s23-530.webp 530w, images/gallery/woodsmans-treehouse-s23-714.webp 714w" }
      ],
      image: {
        src: "images/property-woodsmans-treehouse-999.webp",
        sizes: "(max-width: 420px) 100vw, 420px",
        srcset: "images/property-woodsmans-treehouse-530.webp 530w, images/property-woodsmans-treehouse-999.webp 999w"
      },
      description:
        "Perched in an ancient oak and reached by rope bridge, with a rotating wood burner, roll-top bath and rooftop sauna.",
      longDescription:
        "RIBA South West award winner, 2016. A circular central room with a rotating wood burner, king bed, full kitchen and roll-top bath; upper deck with sauna and hot tub, plus a wood-fired pizza oven and an outdoor tree shower.",
      bookingUrl: "https://mallinson.co.uk/availability/"
    },
    {
      id: "dazzle-treehouse",
      name: "Dazzle Treehouse",
      nameHtml: '<span class="text-weight-normal text-style-italic">Dazzle </span>Treehouse',
      destination: "Dorset",
      type: "Treehouse",
      region: "Dorset",
      sleeps: 2,
      bedrooms: 1,
      bathrooms: 1,
      price: 295,
      featured: 4,
      highlight: "Wood-fired hot tub",
      minimumStay: "2 nights midweek, 3 at weekends",
      photos: [
        { src: "images/gallery/dazzle-treehouse-s01-1060.webp", srcset: "images/gallery/dazzle-treehouse-s01-530.webp 530w, images/gallery/dazzle-treehouse-s01-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s02-1000.webp", srcset: "images/gallery/dazzle-treehouse-s02-530.webp 530w, images/gallery/dazzle-treehouse-s02-1000.webp 1000w" },
        { src: "images/gallery/dazzle-treehouse-s04-1060.webp", srcset: "images/gallery/dazzle-treehouse-s04-530.webp 530w, images/gallery/dazzle-treehouse-s04-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s06-1000.webp", srcset: "images/gallery/dazzle-treehouse-s06-530.webp 530w, images/gallery/dazzle-treehouse-s06-1000.webp 1000w" },
        { src: "images/gallery/dazzle-treehouse-s08-1000.webp", srcset: "images/gallery/dazzle-treehouse-s08-530.webp 530w, images/gallery/dazzle-treehouse-s08-1000.webp 1000w" },
        { src: "images/gallery/dazzle-treehouse-s10-1060.webp", srcset: "images/gallery/dazzle-treehouse-s10-530.webp 530w, images/gallery/dazzle-treehouse-s10-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s12-1060.webp", srcset: "images/gallery/dazzle-treehouse-s12-530.webp 530w, images/gallery/dazzle-treehouse-s12-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s15-1060.webp", srcset: "images/gallery/dazzle-treehouse-s15-530.webp 530w, images/gallery/dazzle-treehouse-s15-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s17-935.webp", srcset: "images/gallery/dazzle-treehouse-s17-530.webp 530w, images/gallery/dazzle-treehouse-s17-935.webp 935w" },
        { src: "images/gallery/dazzle-treehouse-s19-1000.webp", srcset: "images/gallery/dazzle-treehouse-s19-530.webp 530w, images/gallery/dazzle-treehouse-s19-1000.webp 1000w" },
        { src: "images/gallery/dazzle-treehouse-s21-1000.webp", srcset: "images/gallery/dazzle-treehouse-s21-530.webp 530w, images/gallery/dazzle-treehouse-s21-1000.webp 1000w" },
        { src: "images/gallery/dazzle-treehouse-s24-1060.webp", srcset: "images/gallery/dazzle-treehouse-s24-530.webp 530w, images/gallery/dazzle-treehouse-s24-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s26-1060.webp", srcset: "images/gallery/dazzle-treehouse-s26-530.webp 530w, images/gallery/dazzle-treehouse-s26-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s28-1060.webp", srcset: "images/gallery/dazzle-treehouse-s28-530.webp 530w, images/gallery/dazzle-treehouse-s28-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s30-1060.webp", srcset: "images/gallery/dazzle-treehouse-s30-530.webp 530w, images/gallery/dazzle-treehouse-s30-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s32-1060.webp", srcset: "images/gallery/dazzle-treehouse-s32-530.webp 530w, images/gallery/dazzle-treehouse-s32-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s34-1060.webp", srcset: "images/gallery/dazzle-treehouse-s34-530.webp 530w, images/gallery/dazzle-treehouse-s34-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s36-1060.webp", srcset: "images/gallery/dazzle-treehouse-s36-530.webp 530w, images/gallery/dazzle-treehouse-s36-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s38-1060.webp", srcset: "images/gallery/dazzle-treehouse-s38-530.webp 530w, images/gallery/dazzle-treehouse-s38-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s40-1060.webp", srcset: "images/gallery/dazzle-treehouse-s40-530.webp 530w, images/gallery/dazzle-treehouse-s40-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s42-1000.webp", srcset: "images/gallery/dazzle-treehouse-s42-530.webp 530w, images/gallery/dazzle-treehouse-s42-1000.webp 1000w" },
        { src: "images/gallery/dazzle-treehouse-s44-1060.webp", srcset: "images/gallery/dazzle-treehouse-s44-530.webp 530w, images/gallery/dazzle-treehouse-s44-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s46-1060.webp", srcset: "images/gallery/dazzle-treehouse-s46-530.webp 530w, images/gallery/dazzle-treehouse-s46-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s48-1060.webp", srcset: "images/gallery/dazzle-treehouse-s48-530.webp 530w, images/gallery/dazzle-treehouse-s48-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s50-1060.webp", srcset: "images/gallery/dazzle-treehouse-s50-530.webp 530w, images/gallery/dazzle-treehouse-s50-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s52-1060.webp", srcset: "images/gallery/dazzle-treehouse-s52-530.webp 530w, images/gallery/dazzle-treehouse-s52-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s54-1060.webp", srcset: "images/gallery/dazzle-treehouse-s54-530.webp 530w, images/gallery/dazzle-treehouse-s54-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s56-1060.webp", srcset: "images/gallery/dazzle-treehouse-s56-530.webp 530w, images/gallery/dazzle-treehouse-s56-1060.webp 1060w" },
        { src: "images/gallery/dazzle-treehouse-s58-1060.webp", srcset: "images/gallery/dazzle-treehouse-s58-530.webp 530w, images/gallery/dazzle-treehouse-s58-1060.webp 1060w" }
      ],
      image: {
        src: "images/property-dazzle-treehouse-1060.webp",
        sizes: "(max-width: 420px) 100vw, 420px",
        srcset: "images/property-dazzle-treehouse-530.webp 530w, images/property-dazzle-treehouse-1060.webp 1060w"
      },
      description:
        "A contemporary canopy retreat wearing WW1 ship-inspired dazzle camouflage, adults only, deep in Dorset woodland.",
      longDescription:
        "RIBA South West award winner, 2023. Ship-themed throughout, from gangplank entry to glass spine and yacht-deck floors, with a wood-fired hot tub, pizza oven, ceramic wood-burning stove and a cargo-net day bed suspended above the stream.",
      bookingUrl: "https://mallinson.co.uk/availability/"
    },
    {
      id: "pinwheel-treehouse",
      name: "Pinwheel Treehouse",
      nameHtml: '<span class="text-weight-normal text-style-italic">Pinwheel </span>Treehouse',
      destination: "Dorset",
      type: "Treehouse",
      region: "Dorset",
      sleeps: 2,
      bedrooms: 1,
      bathrooms: 1,
      price: 295,
      featured: 6,
      highlight: "Two-person swing",
      minimumStay: "2 nights midweek, 3 at weekends",
      photos: [
        { src: "images/gallery/pinwheel-treehouse-s01-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s01-530.webp 530w, images/gallery/pinwheel-treehouse-s01-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s02-854.webp", srcset: "images/gallery/pinwheel-treehouse-s02-530.webp 530w, images/gallery/pinwheel-treehouse-s02-854.webp 854w" },
        { src: "images/gallery/pinwheel-treehouse-s04-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s04-530.webp 530w, images/gallery/pinwheel-treehouse-s04-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s05-663.webp", srcset: "images/gallery/pinwheel-treehouse-s05-530.webp 530w, images/gallery/pinwheel-treehouse-s05-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s06-711.webp", srcset: "images/gallery/pinwheel-treehouse-s06-530.webp 530w, images/gallery/pinwheel-treehouse-s06-711.webp 711w" },
        { src: "images/gallery/pinwheel-treehouse-s08-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s08-530.webp 530w, images/gallery/pinwheel-treehouse-s08-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s09-663.webp", srcset: "images/gallery/pinwheel-treehouse-s09-530.webp 530w, images/gallery/pinwheel-treehouse-s09-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s10-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s10-530.webp 530w, images/gallery/pinwheel-treehouse-s10-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s11-663.webp", srcset: "images/gallery/pinwheel-treehouse-s11-530.webp 530w, images/gallery/pinwheel-treehouse-s11-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s12-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s12-530.webp 530w, images/gallery/pinwheel-treehouse-s12-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s14-854.webp", srcset: "images/gallery/pinwheel-treehouse-s14-530.webp 530w, images/gallery/pinwheel-treehouse-s14-854.webp 854w" },
        { src: "images/gallery/pinwheel-treehouse-s16-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s16-530.webp 530w, images/gallery/pinwheel-treehouse-s16-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s18-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s18-530.webp 530w, images/gallery/pinwheel-treehouse-s18-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s20-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s20-530.webp 530w, images/gallery/pinwheel-treehouse-s20-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s21-625.webp", srcset: "images/gallery/pinwheel-treehouse-s21-530.webp 530w, images/gallery/pinwheel-treehouse-s21-625.webp 625w" },
        { src: "images/gallery/pinwheel-treehouse-s22-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s22-530.webp 530w, images/gallery/pinwheel-treehouse-s22-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s23-663.webp", srcset: "images/gallery/pinwheel-treehouse-s23-530.webp 530w, images/gallery/pinwheel-treehouse-s23-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s24-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s24-530.webp 530w, images/gallery/pinwheel-treehouse-s24-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s25-663.webp", srcset: "images/gallery/pinwheel-treehouse-s25-530.webp 530w, images/gallery/pinwheel-treehouse-s25-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s26-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s26-530.webp 530w, images/gallery/pinwheel-treehouse-s26-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s27-625.webp", srcset: "images/gallery/pinwheel-treehouse-s27-530.webp 530w, images/gallery/pinwheel-treehouse-s27-625.webp 625w" },
        { src: "images/gallery/pinwheel-treehouse-s28-854.webp", srcset: "images/gallery/pinwheel-treehouse-s28-530.webp 530w, images/gallery/pinwheel-treehouse-s28-854.webp 854w" },
        { src: "images/gallery/pinwheel-treehouse-s30-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s30-530.webp 530w, images/gallery/pinwheel-treehouse-s30-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s32-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s32-530.webp 530w, images/gallery/pinwheel-treehouse-s32-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s34-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s34-530.webp 530w, images/gallery/pinwheel-treehouse-s34-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s35-663.webp", srcset: "images/gallery/pinwheel-treehouse-s35-530.webp 530w, images/gallery/pinwheel-treehouse-s35-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s36-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s36-530.webp 530w, images/gallery/pinwheel-treehouse-s36-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s37-663.webp", srcset: "images/gallery/pinwheel-treehouse-s37-530.webp 530w, images/gallery/pinwheel-treehouse-s37-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s38-711.webp", srcset: "images/gallery/pinwheel-treehouse-s38-530.webp 530w, images/gallery/pinwheel-treehouse-s38-711.webp 711w" },
        { src: "images/gallery/pinwheel-treehouse-s40-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s40-530.webp 530w, images/gallery/pinwheel-treehouse-s40-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s41-663.webp", srcset: "images/gallery/pinwheel-treehouse-s41-530.webp 530w, images/gallery/pinwheel-treehouse-s41-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s42-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s42-530.webp 530w, images/gallery/pinwheel-treehouse-s42-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s44-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s44-530.webp 530w, images/gallery/pinwheel-treehouse-s44-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s45-663.webp", srcset: "images/gallery/pinwheel-treehouse-s45-530.webp 530w, images/gallery/pinwheel-treehouse-s45-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s46-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s46-530.webp 530w, images/gallery/pinwheel-treehouse-s46-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s47-663.webp", srcset: "images/gallery/pinwheel-treehouse-s47-530.webp 530w, images/gallery/pinwheel-treehouse-s47-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s48-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s48-530.webp 530w, images/gallery/pinwheel-treehouse-s48-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s50-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s50-530.webp 530w, images/gallery/pinwheel-treehouse-s50-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s52-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s52-530.webp 530w, images/gallery/pinwheel-treehouse-s52-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s54-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s54-530.webp 530w, images/gallery/pinwheel-treehouse-s54-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s55-663.webp", srcset: "images/gallery/pinwheel-treehouse-s55-530.webp 530w, images/gallery/pinwheel-treehouse-s55-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s56-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s56-530.webp 530w, images/gallery/pinwheel-treehouse-s56-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s58-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s58-530.webp 530w, images/gallery/pinwheel-treehouse-s58-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s60-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s60-530.webp 530w, images/gallery/pinwheel-treehouse-s60-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s62-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s62-530.webp 530w, images/gallery/pinwheel-treehouse-s62-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s64-625.webp", srcset: "images/gallery/pinwheel-treehouse-s64-530.webp 530w, images/gallery/pinwheel-treehouse-s64-625.webp 625w" },
        { src: "images/gallery/pinwheel-treehouse-s65-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s65-530.webp 530w, images/gallery/pinwheel-treehouse-s65-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s67-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s67-530.webp 530w, images/gallery/pinwheel-treehouse-s67-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s68-663.webp", srcset: "images/gallery/pinwheel-treehouse-s68-530.webp 530w, images/gallery/pinwheel-treehouse-s68-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s69-700.webp", srcset: "images/gallery/pinwheel-treehouse-s69-530.webp 530w, images/gallery/pinwheel-treehouse-s69-700.webp 700w" },
        { src: "images/gallery/pinwheel-treehouse-s71-534.webp", srcset: "images/gallery/pinwheel-treehouse-s71-530.webp 530w, images/gallery/pinwheel-treehouse-s71-534.webp 534w" },
        { src: "images/gallery/pinwheel-treehouse-s73-886.webp", srcset: "images/gallery/pinwheel-treehouse-s73-530.webp 530w, images/gallery/pinwheel-treehouse-s73-886.webp 886w" },
        { src: "images/gallery/pinwheel-treehouse-s74-663.webp", srcset: "images/gallery/pinwheel-treehouse-s74-530.webp 530w, images/gallery/pinwheel-treehouse-s74-663.webp 663w" },
        { src: "images/gallery/pinwheel-treehouse-s75-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s75-530.webp 530w, images/gallery/pinwheel-treehouse-s75-1060.webp 1060w" },
        { src: "images/gallery/pinwheel-treehouse-s76-1060.webp", srcset: "images/gallery/pinwheel-treehouse-s76-530.webp 530w, images/gallery/pinwheel-treehouse-s76-1060.webp 1060w" }
      ],
      image: {
        src: "images/property-pinwheel-treehouse-b-1060.webp",
        sizes: "(max-width: 420px) 100vw, 420px",
        srcset: "images/property-pinwheel-treehouse-b-530.webp 530w, images/property-pinwheel-treehouse-b-1060.webp 1060w"
      },
      description:
        "Inspired by a child’s pinwheel, set in a clearing of mature oaks with a glass-topped living space and one-way windows.",
      longDescription:
        "RIBA South West award-winning architecture by Guy Mallinson and Keith Brownlie. Ceramic wood-burning stove, wood-fired pizza oven, outdoor hot tub and a two-person swing. Featured in The World’s Most Secret Hotels.",
      bookingUrl: "https://mallinson.co.uk/availability/"
    }
  ];

  // Compact, self-contained feature icons (sized by the .icon-1x1-xsmall class).
  var ICONS = {
    sleeps:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="icon-1x1-xsmall"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    bedrooms:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="icon-1x1-xsmall"><path d="M3 18V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9"/><path d="M3 14h18"/><path d="M3 18v2M21 18v2"/><path d="M7 11h4"/></svg>',
    bathrooms:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="icon-1x1-xsmall"><path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3Z"/><path d="M6 12V6a2 2 0 0 1 2-2c1 0 1.5.5 2 1"/><path d="M5 19l-1 2M19 19l1 2"/></svg>'
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Build <img> src/sizes/srcset attributes from an image object {src, sizes?, srcset?}.
  function imageAttrs(image) {
    var out = 'src="' + escapeHtml(image.src) + '"';
    if (image.sizes) out += ' sizes="' + escapeHtml(image.sizes) + '"';
    if (image.srcset) out += ' srcset="' + escapeHtml(image.srcset) + '"';
    return out;
  }

  // Read search parameters from a query string (defaults to the current URL).
  function parseParams(search) {
    var params = new URLSearchParams(
      search != null ? search : window.location.search
    );
    var guests = parseInt(params.get("guests"), 10);
    return {
      q: (params.get("q") || "").trim(),
      destination: (params.get("destination") || "").trim(),
      guests: isNaN(guests) ? 0 : guests
    };
  }

  // Filter the catalogue against the given params.
  function filterListings(params) {
    params = params || {};
    var q = (params.q || "").toLowerCase();
    var destination = (params.destination || "").toLowerCase();
    var guests = params.guests || 0;

    return LISTINGS.filter(function (item) {
      if (destination && item.destination.toLowerCase() !== destination) {
        return false;
      }
      if (guests && item.sleeps < guests) {
        return false;
      }
      if (q) {
        var haystack = [
          item.name,
          item.destination,
          item.region,
          item.description
        ]
          .join(" ")
          .toLowerCase();
        if (haystack.indexOf(q) === -1) {
          return false;
        }
      }
      return true;
    });
  }

  function feature(icon, label) {
    return (
      '<div class="feature-icon-wrap">' +
      icon +
      "<p>" +
      escapeHtml(label) +
      "</p></div>"
    );
  }

  // Build one result card matching the site's .search-result-item markup.
  function cardHtml(item) {
    var features =
      feature(ICONS.sleeps, "Sleeps " + item.sleeps) +
      feature(
        ICONS.bedrooms,
        item.bedrooms + (item.bedrooms === 1 ? " bedroom" : " bedrooms")
      ) +
      feature(
        ICONS.bathrooms,
        item.bathrooms + (item.bathrooms === 1 ? " bathroom" : " bathrooms")
      );

    return (
      '<div class="search-result-item">' +
      '<div class="search-item_content-wrap">' +
      '<div class="cabin-item_body">' +
      '<div class="max-width-xlarge align-center">' +
      '<div class="margin-bottom margin-medium">' +
      '<h3 class="heading-style-h2">' +
      item.nameHtml +
      "</h3>" +
      "</div>" +
      "</div>" +
      '<div class="margin-bottom margin-small">' +
      '<div class="cabin-item_feature-wrapper">' +
      '<div class="search-item_feature-wrap">' +
      features +
      "</div>" +
      "<p>" +
      escapeHtml(item.description) +
      "</p>" +
      '<div class="cabin-item_cost"><span>From</span>' +
      '<span class="text-size-large text-weight-bold">£' +
      item.price +
      "</span><span>pn</span></div>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="search-item_widget-wrap">' +
      '<div class="cabin-item_body">' +
      '<a href="' +
      escapeHtml(item.bookingUrl) +
      '" target="_blank" rel="noopener" class="button w-inline-block">' +
      "<span>Check availability</span></a>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="search-item_content-left">' +
      '<div class="search-item_content-gallery-wrap">' +
      "<img " +
      imageAttrs(item.image) +
      ' loading="lazy" alt="' +
      escapeHtml(item.name) +
      '" class="search-item_gallery-img">' +
      "</div>" +
      "</div>" +
      '<div class="search-item_des-wrap">' +
      '<p class="text-size-small">' +
      escapeHtml(item.longDescription) +
      "</p>" +
      "</div>" +
      "</div>"
    );
  }

  // ---- Homepage "Featured Properties" carousel ----------------------------

  var ARROW_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewbox="0 0 17 12" fill="none" class="button_icon"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.2443 5.03644L9.48927 1.21321L10.6935 0L16.5 5.91195L10.6783 11.55L9.50444 10.3067L13.17 6.75673H0V5.03644H13.2443Z" fill="currentColor"></path></svg>';

  // Listings flagged `featured`, in ascending `featured` order.
  function featured() {
    return LISTINGS.filter(function (l) {
      return typeof l.featured === "number";
    }).sort(function (a, b) {
      return a.featured - b.featured;
    });
  }

  // One carousel slide (`.splide__slide`) matching the homepage cabin-card markup.
  // The meta line leads with the region rather than the bedroom count: every
  // featured property has one bedroom, so that number told you nothing, while
  // which of the two sites a property sits on is the thing this section exists
  // to answer. `bedrooms` is still shown on the search-results cards, where
  // listings appear alongside the larger properties and the count does vary.
  function featuredCardHtml(item) {
    var href = "search-results.html?q=" + encodeURIComponent(item.name);

    return (
      '<li class="splide__slide">' +
      '<div class="cabin-item">' +
      '<a href="' +
      href +
      '" class="cabin-item_img-wrap w-inline-block"><img ' +
      imageAttrs(item.image) +
      ' loading="lazy" alt="' +
      escapeHtml(item.name) +
      '" class="cabin-item_img"></a>' +
      '<div class="cabin-item_body">' +
      '<div class="max-width-xlarge align-center">' +
      '<div class="margin-bottom margin-xxsmall">' +
      '<h3 class="heading-style-h4">' +
      escapeHtml(item.name) +
      "</h3>" +
      "</div>" +
      "</div>" +
      '<div class="margin-bottom margin-small">' +
      '<div class="cabin-item_feature-wrapper">' +
      '<div class="cabin-item_features">' +
      "<p>" +
      escapeHtml(item.destination) +
      '</p><span class="seperator-dot">•</span>' +
      "<p>Sleeps " +
      item.sleeps +
      '</p><span class="seperator-dot">•</span>' +
      "<p>" +
      item.bedrooms +
      (item.bedrooms === 1 ? " bedroom" : " bedrooms") +
      "</p>" +
      "</div>" +
      '<div class="cabin-item_cost"><span>From</span><span>£' +
      item.price +
      "</span><span>per night</span></div>" +
      "</div>" +
      "</div>" +
      '<a data-wf--button--variant="base" href="' +
      href +
      '" class="button w-inline-block"><span>View Property</span>' +
      ARROW_SVG +
      "</a>" +
      "</div>" +
      "</div>" +
      "</li>"
    );
  }

  window.CedarHollowSearch = {
    listings: LISTINGS,
    parseParams: parseParams,
    filter: filterListings,
    cardHtml: cardHtml,
    featured: featured,
    featuredCardHtml: featuredCardHtml,
    escapeHtml: escapeHtml
  };
})();
