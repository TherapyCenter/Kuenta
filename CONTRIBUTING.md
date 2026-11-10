# Contributing

**English** · [Deutsch](CONTRIBUTING.de.md)

Bug reports and improvements are welcome, as an issue or a pull request.

## License of contributions

Kuenta is licensed under the GNU AGPL 3.0. The folder `server/pro/` is under the
[Kuenta Pro license](server/pro/LICENSE.md).

By opening a pull request you confirm that you wrote the contribution yourself or are allowed
to pass it on, and that the publisher DoctorD may

- publish it under the AGPL 3.0 and
- also use it under other license terms, including together with Kuenta Pro.

This is necessary because Kuenta is shipped together with the Pro features.

If this English text and the German version differ, the German version applies.

## Rules

- No customer, company or register data in the repository, not even in tests. Test data is made up.
- No npm dependencies without prior agreement. Kuenta only needs Node.js.
- Run `npm test` before opening a pull request.
- Write code comments and commit messages in English.
- Write new user interface texts in German and translate them in `public/js/lang/en.js` and `es.js`. `node tools/i18n/missing.js` shows what is still missing. Values inside a text become `{0}`, `{1}` …, and the translation needs the same placeholders.
