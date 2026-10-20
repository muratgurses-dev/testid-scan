export default function AdminView() {
  return (
    <section>
      <h1>Admin</h1>
      {/* not visited by the accuracy run on purpose: its locators must come out "not visited" */}
      <button data-gt="admin-delete-all" onClick={() => {}}>Delete all</button>
      <a href="#/admin/users" data-gt="admin-users">Users</a>
    </section>
  );
}
