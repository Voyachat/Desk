use super::*;
use crate::local_capability::process_windows_acl_lease::WindowsAclGrantClass;
use getrandom::fill;
use std::fs;
use std::path::PathBuf;

struct TestProfile(Option<String>);

impl Drop for TestProfile {
    fn drop(&mut self) {
        if let Some(profile) = self.0.take() {
            let _ = delete_profile(&profile);
        }
    }
}

struct TestRoot(PathBuf);

impl Drop for TestRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn app_container_profile_create_derive_and_delete_are_recoverable() {
    let operation_id = unique_operation_id();
    let profile = profile_name(&operation_id).expect("profile name");
    let mut cleanup = TestProfile(Some(profile.clone()));
    let created = create_profile(&profile).expect("create unique AppContainer profile");
    let derived = derive_profile_sid(&profile).expect("derive profile SID");
    assert_eq!(created.as_bytes(), derived.as_bytes());

    delete_profile(&profile).expect("delete profile");
    delete_profile(&profile).expect("missing profile cleanup is idempotent");
    let after_delete = derive_profile_sid(&profile).expect("derive deterministic SID");
    assert_eq!(created.as_bytes(), after_delete.as_bytes());
    let recreated = create_profile(&profile).expect("deleted profile can be recreated");
    assert_eq!(created.as_bytes(), recreated.as_bytes());
    delete_profile(&profile).expect("delete recreated profile");
    cleanup.0 = None;
}

#[test]
fn handle_bound_acl_grant_and_revoke_round_trip_on_exact_file() {
    let operation_id = unique_operation_id();
    let profile = profile_name(&operation_id).expect("profile name");
    let sid = create_profile(&profile).expect("create unique AppContainer profile");
    let _profile = TestProfile(Some(profile));
    let root = std::env::temp_dir().join(format!("aistaff-acl-native-{operation_id}"));
    fs::create_dir(&root).expect("create native ACL fixture root");
    let _root = TestRoot(root.clone());
    let executable = root.join("fixture.exe");
    fs::write(&executable, b"fixture").expect("write exact ACL fixture");
    let executable = executable.canonicalize().expect("canonical ACL fixture");
    let target = acl::admit_target(targets::CandidateAclTarget {
        path: executable,
        grant_class: WindowsAclGrantClass::ExecutableReadExecute,
    })
    .expect("admit exact file handle");

    acl::grant_target(&target, sid.as_psid()).expect("grant exact AppContainer ACE");
    acl::revoke_target(&target, sid.as_psid()).expect("revoke exact AppContainer ACE");
}

fn unique_operation_id() -> String {
    let mut bytes = [0_u8; 16];
    fill(&mut bytes).expect("generate unique operation id");
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}
